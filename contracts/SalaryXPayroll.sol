// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/**
 * @title SalaryXPayroll
 * @notice Prefunded USDC payroll with company-scoped roles and reserved monthly commitments.
 * @dev DESIGN / ROLES: The platform owner controls registration, suspension and pause,
 * but has no company spending privilege. Each company admin controls its managers,
 * executor, allowance, withdrawals and two-step admin succession. Managers schedule
 * payments and can cancel their own batches while still authorized. An executor
 * can only release immutable, due, preauthorized batches; it cannot redirect funds.
 * Roles are additive: do not give a keeper admin/manager privileges if it must only execute.
 *
 * THREAT MODEL: Trust admins/managers to choose recipients and UTC schedule periods.
 * A stolen executor key can accelerate execution only up to the already approved due
 * schedule; it cannot create batches, withdraw funds or change commitments. It can
 * withhold service, so admins and managers can also execute. Owner suspension/pause
 * can stop payroll, not cancellation or withdrawal of unreserved company funds.
 * Admin compromise permits withdrawing available funds; manager compromise permits
 * allocating available budget within each period's allowance to arbitrary recipients.
 *
 * KEEPER BOUNDARY: No keeper-provided payment data or price oracle is used. Period is
 * derived exclusively from executeAfter in UTC, including past timestamps. The cap
 * is a scheduled-period commitment cap, NOT an actual execution-month spending cap:
 * backdated batches and batches for different months may all execute in one month.
 * Executed commitments and recipient flags persist. Lowering allowance does not
 * invalidate existing batches; a zero allowance only prevents new commitments.
 *
 * TOKEN / PRIVACY: Supply the trusted Arc Testnet USDC ERC-20 predeploy as the token
 * constructor argument; amounts use its six-decimal base units. Arc USDC is
 * native-backed; this contract holds only its ERC-20 view, not native currency.
 * No native receive/fallback exists. Direct ERC-20 transfers are not credited and
 * have no recovery path. Fee-on-transfer/rebasing tokens are unsupported.
 * Addresses, amounts, timestamps and opaque references are public; never put
 * personal data in a reference. Execution is atomic: if a wallet is blocked or
 * reverts, an authorized admin or the still-manager creator must cancel and recreate
 * the batch without that wallet. Suspension does not make frozen USDC transferable.
 */
contract SalaryXPayroll is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    uint16 public constant MAX_BATCH = 100;
    IERC20 public immutable usdc;
    bool public registrationOpen = true;
    uint256 public nextBatchId = 1;

    enum Status { None, Created, Executed, Cancelled }

    /// @notice Exactly one storage slot per payment.
    struct Payment {
        address recipient;
        uint96 amount;
    }

    struct Company {
        address admin;
        address executor;
        bool active;
        uint128 budget;
        uint128 reserved;
        uint128 monthlyAllowance;
    }

    struct CompanyView {
        address admin;
        address executor;
        bool active;
        uint128 budget;
        uint128 reserved;
        uint128 monthlyAllowance;
        uint128 available;
    }

    struct Batch {
        bytes32 companyId;
        bytes32 ref;
        uint64 executeAfter;
        uint32 period;
        uint128 total;
        address creator;
        Status status;
        uint16 count;
    }

    mapping(bytes32 => Company) private _companies;
    mapping(bytes32 => mapping(address => bool)) private _managers;
    mapping(bytes32 => address) public pendingAdmin;
    mapping(bytes32 => mapping(uint32 => uint128)) private _committed;
    mapping(bytes32 => mapping(uint32 => mapping(address => bool))) private _scheduled;
    mapping(uint256 => Batch) private _batches;
    mapping(uint256 => Payment[]) private _payments;

    error ZeroAddress();
    error RenounceDisabled();
    error InvalidCompanyId();
    error CompanyAlreadyExists(bytes32 companyId);
    error UnknownCompany(bytes32 companyId);
    error CompanyInactive(bytes32 companyId);
    error RegistrationClosed();
    error Unauthorized(address caller);
    error InvalidAmount();
    error InvalidRecipient(address recipient);
    error InvalidPaymentCount();
    error LengthMismatch();
    error ScheduleTooFar();
    error AllowanceExceeded();
    error InsufficientAvailableBudget();
    error RecipientAlreadyScheduled(address recipient, uint32 period);
    error InvalidBatchStatus(uint256 batchId);
    error BatchNotDue(uint256 batchId);
    error UnexpectedTokenReceipt();

    event CompanyRegistered(bytes32 indexed companyId, address indexed admin);
    event CompanyActiveSet(bytes32 indexed companyId, bool active);
    event RegistrationOpenSet(bool open);
    event ManagerSet(bytes32 indexed companyId, address indexed manager, bool enabled);
    event ExecutorSet(bytes32 indexed companyId, address indexed executor);
    event MonthlyAllowanceSet(bytes32 indexed companyId, uint128 amount);
    event AdminProposed(bytes32 indexed companyId, address indexed admin, address indexed proposedAdmin);
    event AdminAccepted(bytes32 indexed companyId, address indexed previousAdmin, address indexed newAdmin);
    event BudgetDeposited(bytes32 indexed companyId, address indexed from, uint128 amount);
    event BudgetWithdrawn(bytes32 indexed companyId, address indexed to, uint128 amount);
    event BatchCreated(
        uint256 indexed batchId, bytes32 indexed companyId, uint32 indexed period,
        bytes32 ref, uint64 executeAfter, uint128 total, uint16 count, address creator
    );
    event PaymentScheduled(uint256 indexed batchId, address indexed recipient, uint96 amount);
    event SalaryPaid(
        uint256 indexed batchId, bytes32 indexed companyId, address indexed recipient,
        uint96 amount, uint32 period
    );
    event BatchExecuted(
        uint256 indexed batchId, bytes32 indexed companyId, uint128 total, uint16 count, address caller
    );
    event BatchCancelled(uint256 indexed batchId, bytes32 indexed companyId, address caller);

    /// @param usdc_ Trusted six-decimal USDC ERC-20; never hardcoded by this contract.
    /// @param owner_ Initial platform owner; company privileges are independent.
    constructor(IERC20 usdc_, address owner_) Ownable(owner_) {
        if (address(usdc_) == address(0) || owner_ == address(0)) revert ZeroAddress();
        usdc = usdc_;
    }

    modifier onlyCompanyAdmin(bytes32 companyId) {
        Company storage company = _company(companyId);
        if (msg.sender != company.admin) revert Unauthorized(msg.sender);
        _;
    }

    /// @notice Register a unique company; registration has a separate owner-controlled gate.
    function registerCompany(bytes32 companyId) external {
        if (!registrationOpen) revert RegistrationClosed();
        if (companyId == bytes32(0)) revert InvalidCompanyId();
        if (_companies[companyId].admin != address(0)) revert CompanyAlreadyExists(companyId);
        _companies[companyId].admin = msg.sender;
        _companies[companyId].active = true;
        emit CompanyRegistered(companyId, msg.sender);
    }

    /// @notice Enable or revoke a manager, independently of execution pause/suspension.
    function setManager(bytes32 companyId, address manager, bool enabled) external onlyCompanyAdmin(companyId) {
        if (manager == address(0)) revert ZeroAddress();
        _managers[companyId][manager] = enabled;
        emit ManagerSet(companyId, manager, enabled);
    }

    /// @notice Set the execution-only wallet; zero disables this role.
    function setExecutor(bytes32 companyId, address executor) external onlyCompanyAdmin(companyId) {
        _companies[companyId].executor = executor;
        emit ExecutorSet(companyId, executor);
    }

    /// @notice Set the cap used for future creations; existing commitments are unchanged.
    function setMonthlyAllowance(bytes32 companyId, uint128 amount) external onlyCompanyAdmin(companyId) {
        _companies[companyId].monthlyAllowance = amount;
        emit MonthlyAllowanceSet(companyId, amount);
    }

    /// @notice Start or replace company admin succession. Manager/executor roles persist.
    function proposeAdmin(bytes32 companyId, address newAdmin) external onlyCompanyAdmin(companyId) {
        if (newAdmin == address(0)) revert ZeroAddress();
        pendingAdmin[companyId] = newAdmin;
        emit AdminProposed(companyId, msg.sender, newAdmin);
    }

    /// @notice Accept a pending admin transfer, including while paused or suspended.
    function acceptAdmin(bytes32 companyId) external {
        Company storage company = _company(companyId);
        if (pendingAdmin[companyId] != msg.sender) revert Unauthorized(msg.sender);
        address previous = company.admin;
        company.admin = msg.sender;
        delete pendingAdmin[companyId];
        emit AdminAccepted(companyId, previous, msg.sender);
    }

    /// @notice Suspend or reactivate an existing company without taking custody of its budget.
    function setCompanyActive(bytes32 companyId, bool active) external onlyOwner {
        _company(companyId).active = active;
        emit CompanyActiveSet(companyId, active);
    }

    /// @notice Control the independent gate for new registrations.
    function setRegistrationOpen(bool open) external onlyOwner {
        registrationOpen = open;
        emit RegistrationOpenSet(open);
    }

    /// @notice Stop deposits, batch creation and batch execution.
    function pause() external onlyOwner { _pause(); }

    /// @notice Renouncing ownership is disabled so a paused contract can always be resumed.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    /// @notice Resume deposits, batch creation and batch execution.
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Fund an active company; only exact ERC-20 receipts are credited.
    function depositBudget(bytes32 companyId, uint128 amount) external whenNotPaused nonReentrant {
        Company storage company = _activeCompany(companyId);
        if (amount == 0) revert InvalidAmount();
        uint256 beforeBalance = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        if (usdc.balanceOf(address(this)) != beforeBalance + amount) revert UnexpectedTokenReceipt();
        company.budget += amount;
        emit BudgetDeposited(companyId, msg.sender, amount);
    }

    /// @notice Withdraw only unreserved funds; intentionally works during pause/suspension.
    function withdrawBudget(bytes32 companyId, address to, uint128 amount)
        external onlyCompanyAdmin(companyId) nonReentrant
    {
        if (to == address(0)) revert ZeroAddress();
        if (to == address(this)) revert InvalidRecipient(to);
        if (amount == 0) revert InvalidAmount();
        Company storage company = _companies[companyId];
        if (amount > company.budget - company.reserved) revert InsufficientAvailableBudget();
        company.budget -= amount;
        usdc.safeTransfer(to, amount);
        emit BudgetWithdrawn(companyId, to, amount);
    }

    /// @notice Reserve payroll against its executeAfter UTC month, even if backdated.
    /// @dev Recipient flags are set while iterating, so duplicates within this call also revert.
    function createBatch(
        bytes32 companyId, bytes32 ref, uint64 executeAfter,
        address[] calldata recipients, uint96[] calldata amounts
    ) external whenNotPaused nonReentrant returns (uint256 batchId) {
        Company storage company = _activeCompany(companyId);
        if (msg.sender != company.admin && !_managers[companyId][msg.sender]) revert Unauthorized(msg.sender);
        if (recipients.length == 0 || recipients.length > MAX_BATCH) revert InvalidPaymentCount();
        if (recipients.length != amounts.length) revert LengthMismatch();
        if (uint256(executeAfter) > block.timestamp + 366 days) revert ScheduleTooFar();

        batchId = nextBatchId++;
        Batch storage batch = _batches[batchId];
        batch.companyId = companyId;
        batch.ref = ref;
        batch.executeAfter = executeAfter;
        batch.period = _periodFor(executeAfter);
        batch.creator = msg.sender;
        batch.status = Status.Created;
        batch.count = recipients.length.toUint16();
        batch.total = _schedulePayments(batchId, recipients, amounts);

        if (company.monthlyAllowance == 0 ||
            uint256(_committed[companyId][batch.period]) + batch.total > company.monthlyAllowance
        ) revert AllowanceExceeded();
        if (batch.total > company.budget - company.reserved) revert InsufficientAvailableBudget();
        company.reserved += batch.total;
        _committed[companyId][batch.period] += batch.total;
        _emitBatchCreated(batchId, batch);
    }

    /// @notice Release a due batch atomically; the caller cannot supply payment destinations.
    function executeBatch(uint256 batchId) external whenNotPaused nonReentrant {
        Batch storage batch = _createdBatch(batchId);
        Company storage company = _activeCompany(batch.companyId);
        if (msg.sender != company.admin && msg.sender != company.executor &&
            !_managers[batch.companyId][msg.sender]) revert Unauthorized(msg.sender);
        if (block.timestamp < batch.executeAfter) revert BatchNotDue(batchId);

        batch.status = Status.Executed;
        company.budget -= batch.total;
        company.reserved -= batch.total;
        Payment[] storage payments = _payments[batchId];
        for (uint256 i; i < payments.length; ++i) {
            Payment memory payment = payments[i];
            usdc.safeTransfer(payment.recipient, payment.amount);
            emit SalaryPaid(batchId, batch.companyId, payment.recipient, payment.amount, batch.period);
        }
        emit BatchExecuted(batchId, batch.companyId, batch.total, batch.count, msg.sender);
    }

    /// @notice Release reservations and duplicate flags; works while paused/suspended.
    /// @dev A creator who is no longer a manager cannot cancel unless now the admin.
    function cancelBatch(uint256 batchId) external nonReentrant {
        Batch storage batch = _createdBatch(batchId);
        Company storage company = _companies[batch.companyId];
        if (msg.sender != company.admin &&
            !(msg.sender == batch.creator && _managers[batch.companyId][msg.sender])
        ) revert Unauthorized(msg.sender);
        batch.status = Status.Cancelled;
        company.reserved -= batch.total;
        _committed[batch.companyId][batch.period] -= batch.total;
        Payment[] storage payments = _payments[batchId];
        for (uint256 i; i < payments.length; ++i) {
            delete _scheduled[batch.companyId][batch.period][payments[i].recipient];
        }
        emit BatchCancelled(batchId, batch.companyId, msg.sender);
    }

    /// @notice Return company accounting, including its unreserved balance.
    function getCompany(bytes32 companyId) external view returns (CompanyView memory result) {
        Company storage company = _company(companyId);
        result = CompanyView(company.admin, company.executor, company.active, company.budget,
            company.reserved, company.monthlyAllowance, company.budget - company.reserved);
    }

    /// @notice Whether an address has the explicit manager role (admin is independent).
    function isManager(bytes32 companyId, address account) external view returns (bool) {
        return _managers[companyId][account];
    }

    /// @notice Unknown IDs return the default struct with Status.None.
    function getBatch(uint256 batchId) external view returns (Batch memory) { return _batches[batchId]; }

    /// @notice Return the immutable payment list, retained after execution/cancellation.
    function getBatchPayments(uint256 batchId) external view returns (Payment[] memory) { return _payments[batchId]; }

    /// @notice Sum of Created and Executed amounts committed to a UTC period.
    function committedFor(bytes32 companyId, uint32 period) external view returns (uint128) {
        return _committed[companyId][period];
    }

    /// @notice Total batches ever created, including cancelled batches.
    function batchCount() external view returns (uint256) { return nextBatchId - 1; }

    /// @notice True for recipients with a Created or Executed payment in this period.
    function isScheduled(bytes32 companyId, uint32 period, address recipient) external view returns (bool) {
        return _scheduled[companyId][period][recipient];
    }

    function _company(bytes32 companyId) private view returns (Company storage company) {
        company = _companies[companyId];
        if (company.admin == address(0)) revert UnknownCompany(companyId);
    }

    function _activeCompany(bytes32 companyId) private view returns (Company storage company) {
        company = _company(companyId);
        if (!company.active) revert CompanyInactive(companyId);
    }

    function _createdBatch(uint256 batchId) private view returns (Batch storage batch) {
        batch = _batches[batchId];
        if (batch.status != Status.Created) revert InvalidBatchStatus(batchId);
    }

    function _schedulePayments(uint256 batchId, address[] calldata recipients, uint96[] calldata amounts)
        private returns (uint128)
    {
        Batch storage batch = _batches[batchId];
        uint256 total;
        for (uint256 i; i < recipients.length; ++i) {
            address recipient = recipients[i];
            uint96 amount = amounts[i];
            if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient(recipient);
            if (amount == 0) revert InvalidAmount();
            if (_scheduled[batch.companyId][batch.period][recipient]) {
                revert RecipientAlreadyScheduled(recipient, batch.period);
            }
            _scheduled[batch.companyId][batch.period][recipient] = true;
            total += amount;
            _payments[batchId].push(Payment(recipient, amount));
            emit PaymentScheduled(batchId, recipient, amount);
        }
        return total.toUint128();
    }

    function _emitBatchCreated(uint256 batchId, Batch storage batch) private {
        emit BatchCreated(batchId, batch.companyId, batch.period, batch.ref,
            batch.executeAfter, batch.total, batch.count, batch.creator);
    }

    /// @dev Howard Hinnant civil-from-days, Gregorian calendar, Unix days >= 0.
    /// Only the month/year are needed. Offset makes the algorithm's year start March.
    function _periodFor(uint64 timestamp) private pure returns (uint32) {
        uint256 z = uint256(timestamp) / 1 days + 719468;
        uint256 era = z / 146097;
        uint256 doe = z - era * 146097;
        uint256 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        uint256 year = yoe + era * 400;
        uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        uint256 mp = (5 * doy + 2) / 153;
        uint256 month = mp < 10 ? mp + 3 : mp - 9;
        if (month <= 2) year += 1;
        return (year * 100 + month).toUint32();
    }
}
