// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {SalaryXPayroll} from "../SalaryXPayroll.sol";

/// @dev Simple 6-decimal mock USDC.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Fee-on-transfer token: burns 1 unit from the receiver on every transfer.
contract FeeUSDC is MockUSDC {
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (from != address(0) && to != address(0) && value > 0) _burn(to, 1);
    }
}

abstract contract PayrollBase is Test {
    MockUSDC internal usdc;
    SalaryXPayroll internal pay;

    address internal owner = makeAddr("owner");
    address internal admin = makeAddr("admin");
    address internal manager = makeAddr("manager");
    address internal executor = makeAddr("executor");
    address internal stranger = makeAddr("stranger");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    bytes32 internal constant CO = keccak256("acme");
    bytes32 internal constant CO2 = keccak256("globex");
    bytes32 internal constant REF = keccak256("ref");

    uint64 internal constant NOW_TS = 1_768_435_200; // 2026-01-15 00:00:00 UTC
    uint32 internal constant P_NOW = 202601;
    uint256 internal constant INIT_BUDGET = 10_000e6;
    uint128 internal constant ALLOWANCE = 100_000e6;

    function setUp() public virtual {
        vm.warp(NOW_TS);
        usdc = new MockUSDC();
        pay = new SalaryXPayroll(IERC20(address(usdc)), owner);

        usdc.mint(admin, 1_000_000e6);
        vm.prank(admin);
        usdc.approve(address(pay), type(uint256).max);

        vm.startPrank(admin);
        pay.registerCompany(CO);
        pay.setManager(CO, manager, true);
        pay.setExecutor(CO, executor);
        pay.setMonthlyAllowance(CO, ALLOWANCE);
        pay.depositBudget(CO, uint128(INIT_BUDGET));
        vm.stopPrank();
    }

    function _a1(address a) internal pure returns (address[] memory r) {
        r = new address[](1);
        r[0] = a;
    }

    function _u1(uint96 a) internal pure returns (uint96[] memory r) {
        r = new uint96[](1);
        r[0] = a;
    }

    function _a2(address a, address b) internal pure returns (address[] memory r) {
        r = new address[](2);
        r[0] = a;
        r[1] = b;
    }

    function _u2(uint96 a, uint96 b) internal pure returns (uint96[] memory r) {
        r = new uint96[](2);
        r[0] = a;
        r[1] = b;
    }

    /// @dev Create a single-recipient batch for CO as `who`.
    function _create(address who, uint64 when, address rcpt, uint96 amt) internal returns (uint256 id) {
        address[] memory rs = _a1(rcpt);
        uint96[] memory as_ = _u1(amt);
        vm.prank(who);
        id = pay.createBatch(CO, REF, when, rs, as_);
    }

    function _co() internal view returns (SalaryXPayroll.CompanyView memory) {
        return pay.getCompany(CO);
    }
}

/// @notice Setup, registration, roles, admin transfer, owner controls, deposit, withdraw.
contract SalaryXPayrollTest is PayrollBase {
    // ───────────── Deployment ─────────────
    function test_Constructor_SetsState() public view {
        assertEq(address(pay.usdc()), address(usdc));
        assertEq(pay.owner(), owner);
        assertTrue(pay.registrationOpen());
        assertEq(pay.nextBatchId(), 1);
        assertEq(pay.batchCount(), 0);
        assertEq(pay.MAX_BATCH(), 100);
    }

    function test_RevertWhen_ConstructorZeroToken() public {
        vm.expectRevert(SalaryXPayroll.ZeroAddress.selector);
        new SalaryXPayroll(IERC20(address(0)), owner);
    }

    function test_RevertWhen_ConstructorZeroOwner() public {
        // Ownable's constructor runs first, so its own error fires.
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new SalaryXPayroll(IERC20(address(usdc)), address(0));
    }

    // ───────────── Registration ─────────────
    function test_RegisterCompany_SetsAdminAndActive() public {
        vm.prank(alice);
        pay.registerCompany(CO2);
        SalaryXPayroll.CompanyView memory c = pay.getCompany(CO2);
        assertEq(c.admin, alice);
        assertTrue(c.active);
        assertEq(c.budget, 0);
        assertEq(c.reserved, 0);
        assertEq(c.available, 0);
        assertEq(c.executor, address(0));
        assertEq(c.monthlyAllowance, 0);
    }

    function test_RegisterCompany_EmitsEvent() public {
        vm.expectEmit(true, true, false, false, address(pay));
        emit SalaryXPayroll.CompanyRegistered(CO2, alice);
        vm.prank(alice);
        pay.registerCompany(CO2);
    }

    function test_RevertWhen_RegisterZeroId() public {
        vm.expectRevert(SalaryXPayroll.InvalidCompanyId.selector);
        pay.registerCompany(bytes32(0));
    }

    function test_RevertWhen_RegisterDuplicate() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.CompanyAlreadyExists.selector, CO));
        pay.registerCompany(CO);
    }

    function test_RevertWhen_RegistrationClosed() public {
        vm.prank(owner);
        pay.setRegistrationOpen(false);
        vm.prank(alice);
        vm.expectRevert(SalaryXPayroll.RegistrationClosed.selector);
        pay.registerCompany(CO2);
    }

    function test_SetRegistrationOpen_OwnerTogglesAndEmits() public {
        vm.expectEmit(false, false, false, true, address(pay));
        emit SalaryXPayroll.RegistrationOpenSet(false);
        vm.prank(owner);
        pay.setRegistrationOpen(false);
        assertFalse(pay.registrationOpen());

        vm.prank(owner);
        pay.setRegistrationOpen(true);
        vm.prank(alice);
        pay.registerCompany(CO2); // works again
    }

    function test_RevertWhen_NonOwnerSetsRegistrationOpen() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, admin));
        pay.setRegistrationOpen(false);
    }

    function test_ClosedRegistrationDoesNotAffectExistingCompany() public {
        vm.prank(owner);
        pay.setRegistrationOpen(false);
        vm.prank(admin);
        pay.depositBudget(CO, 1e6);
        assertEq(_co().budget, INIT_BUDGET + 1e6);
    }

    function test_GetCompany_RevertsForUnknown() public {
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.UnknownCompany.selector, CO2));
        pay.getCompany(CO2);
    }

    // ───────────── Roles ─────────────
    function test_SetManager_EnablesDisablesAndEmits() public {
        assertTrue(pay.isManager(CO, manager));
        vm.expectEmit(true, true, false, true, address(pay));
        emit SalaryXPayroll.ManagerSet(CO, alice, true);
        vm.prank(admin);
        pay.setManager(CO, alice, true);
        assertTrue(pay.isManager(CO, alice));

        vm.expectEmit(true, true, false, true, address(pay));
        emit SalaryXPayroll.ManagerSet(CO, alice, false);
        vm.prank(admin);
        pay.setManager(CO, alice, false);
        assertFalse(pay.isManager(CO, alice));
    }

    function test_RevertWhen_NonAdminSetsManager() public {
        address[3] memory callers = [manager, executor, owner];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.Unauthorized.selector, callers[i]));
            pay.setManager(CO, alice, true);
        }
    }

    function test_RevertWhen_SetManagerZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(SalaryXPayroll.ZeroAddress.selector);
        pay.setManager(CO, address(0), true);
    }

    function test_RevertWhen_SetManagerUnknownCompany() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.UnknownCompany.selector, CO2));
        pay.setManager(CO2, alice, true);
    }

    function test_SetExecutor_SetsAndEmits() public {
        vm.expectEmit(true, true, false, false, address(pay));
        emit SalaryXPayroll.ExecutorSet(CO, alice);
        vm.prank(admin);
        pay.setExecutor(CO, alice);
        assertEq(_co().executor, alice);

        vm.prank(admin);
        pay.setExecutor(CO, address(0)); // zero disables
        assertEq(_co().executor, address(0));
    }

    function test_RevertWhen_NonAdminSetsExecutor() public {
        vm.prank(manager);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.Unauthorized.selector, manager));
        pay.setExecutor(CO, alice);
    }

    function test_SetMonthlyAllowance_SetsAndEmits() public {
        vm.expectEmit(true, false, false, true, address(pay));
        emit SalaryXPayroll.MonthlyAllowanceSet(CO, 5e6);
        vm.prank(admin);
        pay.setMonthlyAllowance(CO, 5e6);
        assertEq(_co().monthlyAllowance, 5e6);
    }

    function test_RevertWhen_NonAdminSetsAllowance() public {
        vm.prank(manager);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.Unauthorized.selector, manager));
        pay.setMonthlyAllowance(CO, 1);
    }

    // ───────────── Two-step admin transfer ─────────────
    function test_AdminTransfer_TwoStepHappyPath() public {
        vm.expectEmit(true, true, true, false, address(pay));
        emit SalaryXPayroll.AdminProposed(CO, admin, alice);
        vm.prank(admin);
        pay.proposeAdmin(CO, alice);
        assertEq(pay.pendingAdmin(CO), alice);
        assertEq(_co().admin, admin, "admin unchanged until accept");

        vm.expectEmit(true, true, true, false, address(pay));
        emit SalaryXPayroll.AdminAccepted(CO, admin, alice);
        vm.prank(alice);
        pay.acceptAdmin(CO);

        assertEq(_co().admin, alice);
        assertEq(pay.pendingAdmin(CO), address(0));

        // old admin lost privileges, new admin has them; manager/executor persist
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.Unauthorized.selector, admin));
        pay.setExecutor(CO, bob);
        vm.prank(alice);
        pay.setExecutor(CO, bob);
        assertTrue(pay.isManager(CO, manager));
    }

    function test_RevertWhen_AcceptWithoutProposal() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.Unauthorized.selector, alice));
        pay.acceptAdmin(CO);
    }

    function test_RevertWhen_WrongAddressAccepts() public {
        vm.prank(admin);
        pay.proposeAdmin(CO, alice);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.Unauthorized.selector, bob));
        pay.acceptAdmin(CO);
    }

    function test_RevertWhen_ProposeByNonAdminOrZero() public {
        vm.prank(manager);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.Unauthorized.selector, manager));
        pay.proposeAdmin(CO, alice);

        vm.prank(admin);
        vm.expectRevert(SalaryXPayroll.ZeroAddress.selector);
        pay.proposeAdmin(CO, address(0));
    }

    function test_ProposeReplacesPendingAdmin() public {
        vm.startPrank(admin);
        pay.proposeAdmin(CO, alice);
        pay.proposeAdmin(CO, bob);
        vm.stopPrank();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.Unauthorized.selector, alice));
        pay.acceptAdmin(CO);
        vm.prank(bob);
        pay.acceptAdmin(CO);
        assertEq(_co().admin, bob);
    }

    function test_AcceptAdmin_WorksWhilePausedAndSuspended() public {
        vm.prank(admin);
        pay.proposeAdmin(CO, alice);
        vm.startPrank(owner);
        pay.pause();
        pay.setCompanyActive(CO, false);
        vm.stopPrank();
        vm.prank(alice);
        pay.acceptAdmin(CO);
        assertEq(_co().admin, alice);
    }

    function test_RevertWhen_AcceptUnknownCompany() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.UnknownCompany.selector, CO2));
        pay.acceptAdmin(CO2);
    }

    // ───────────── Platform owner controls ─────────────
    function test_SetCompanyActive_OwnerOnlyAndEmits() public {
        vm.expectEmit(true, false, false, true, address(pay));
        emit SalaryXPayroll.CompanyActiveSet(CO, false);
        vm.prank(owner);
        pay.setCompanyActive(CO, false);
        assertFalse(_co().active);

        vm.prank(owner);
        pay.setCompanyActive(CO, true);
        assertTrue(_co().active);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, admin));
        pay.setCompanyActive(CO, false);
    }

    function test_RevertWhen_SuspendUnknownCompany() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.UnknownCompany.selector, CO2));
        pay.setCompanyActive(CO2, false);
    }

    function test_PauseUnpause_OwnerOnly() public {
        vm.prank(owner);
        pay.pause();
        assertTrue(pay.paused());
        vm.prank(owner);
        pay.unpause();
        assertFalse(pay.paused());

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, admin));
        pay.pause();
        vm.prank(owner);
        pay.pause();
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, admin));
        pay.unpause();
    }

    function test_OwnerTransfer_IsTwoStep() public {
        vm.prank(owner);
        pay.transferOwnership(alice);
        assertEq(pay.owner(), owner);
        vm.prank(alice);
        pay.acceptOwnership();
        assertEq(pay.owner(), alice);
    }

    function test_OwnerHasNoCompanySpendingPrivilege() public {
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.Unauthorized.selector, owner));
        pay.withdrawBudget(CO, owner, 1e6);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.Unauthorized.selector, owner));
        pay.createBatch(CO, REF, NOW_TS, _a1(alice), _u1(1e6));
        vm.stopPrank();
    }

    // ───────────── Deposit ─────────────
    function test_DepositBudget_CreditsAndEmits() public {
        vm.expectEmit(true, true, false, true, address(pay));
        emit SalaryXPayroll.BudgetDeposited(CO, admin, 500e6);
        vm.prank(admin);
        pay.depositBudget(CO, 500e6);
        assertEq(_co().budget, INIT_BUDGET + 500e6);
        assertEq(usdc.balanceOf(address(pay)), INIT_BUDGET + 500e6);
    }

    function test_DepositBudget_AnyoneCanFundCompany() public {
        usdc.mint(stranger, 100e6);
        vm.startPrank(stranger);
        usdc.approve(address(pay), 100e6);
        pay.depositBudget(CO, 100e6);
        vm.stopPrank();
        assertEq(_co().budget, INIT_BUDGET + 100e6);
        assertEq(usdc.balanceOf(stranger), 0);
    }

    function test_RevertWhen_DepositZero() public {
        vm.prank(admin);
        vm.expectRevert(SalaryXPayroll.InvalidAmount.selector);
        pay.depositBudget(CO, 0);
    }

    function test_RevertWhen_DepositPaused() public {
        vm.prank(owner);
        pay.pause();
        vm.prank(admin);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        pay.depositBudget(CO, 1e6);
    }

    function test_RevertWhen_DepositInactiveCompany() public {
        vm.prank(owner);
        pay.setCompanyActive(CO, false);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.CompanyInactive.selector, CO));
        pay.depositBudget(CO, 1e6);
    }

    function test_RevertWhen_DepositUnknownCompany() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.UnknownCompany.selector, CO2));
        pay.depositBudget(CO2, 1e6);
    }

    function test_RevertWhen_DepositWithoutAllowance() public {
        usdc.mint(bob, 10e6);
        vm.prank(bob);
        vm.expectRevert(); // ERC20InsufficientAllowance
        pay.depositBudget(CO, 1e6);
    }

    function test_RevertWhen_DepositFeeOnTransferToken() public {
        FeeUSDC fee = new FeeUSDC();
        SalaryXPayroll p2 = new SalaryXPayroll(IERC20(address(fee)), owner);
        fee.mint(admin, 1_000e6);
        vm.startPrank(admin);
        fee.approve(address(p2), type(uint256).max);
        p2.registerCompany(CO);
        vm.expectRevert(SalaryXPayroll.UnexpectedTokenReceipt.selector);
        p2.depositBudget(CO, 100e6);
        vm.stopPrank();
    }

    // ───────────── Withdraw ─────────────
    function test_WithdrawBudget_AdminHappyPathAndEvent() public {
        uint256 before = usdc.balanceOf(alice);
        vm.expectEmit(true, true, false, true, address(pay));
        emit SalaryXPayroll.BudgetWithdrawn(CO, alice, 1_000e6);
        vm.prank(admin);
        pay.withdrawBudget(CO, alice, 1_000e6);
        assertEq(usdc.balanceOf(alice), before + 1_000e6);
        assertEq(_co().budget, INIT_BUDGET - 1_000e6);
        assertEq(usdc.balanceOf(address(pay)), INIT_BUDGET - 1_000e6);
    }

    function test_WithdrawBudget_FullUnreservedBalance() public {
        vm.prank(admin);
        pay.withdrawBudget(CO, alice, uint128(INIT_BUDGET));
        assertEq(_co().budget, 0);
    }

    function test_RevertWhen_WithdrawByNonAdmin() public {
        address[3] memory callers = [manager, executor, stranger];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.Unauthorized.selector, callers[i]));
            pay.withdrawBudget(CO, callers[i], 1e6);
        }
    }

    function test_RevertWhen_WithdrawBadArgs() public {
        vm.startPrank(admin);
        vm.expectRevert(SalaryXPayroll.ZeroAddress.selector);
        pay.withdrawBudget(CO, address(0), 1e6);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.InvalidRecipient.selector, address(pay)));
        pay.withdrawBudget(CO, address(pay), 1e6);
        vm.expectRevert(SalaryXPayroll.InvalidAmount.selector);
        pay.withdrawBudget(CO, alice, 0);
        vm.expectRevert(SalaryXPayroll.InsufficientAvailableBudget.selector);
        pay.withdrawBudget(CO, alice, uint128(INIT_BUDGET) + 1);
        vm.stopPrank();
    }

    function test_RevertWhen_WithdrawingReservedFunds() public {
        _create(admin, NOW_TS + 1 days, alice, 6_000e6);
        // available = 4_000e6
        vm.startPrank(admin);
        vm.expectRevert(SalaryXPayroll.InsufficientAvailableBudget.selector);
        pay.withdrawBudget(CO, admin, 4_000e6 + 1);
        pay.withdrawBudget(CO, admin, 4_000e6);
        vm.stopPrank();
        assertEq(_co().available, 0);
        assertEq(_co().reserved, 6_000e6);
    }

    function test_WithdrawBudget_WorksWhilePausedAndSuspended() public {
        vm.startPrank(owner);
        pay.pause();
        pay.setCompanyActive(CO, false);
        vm.stopPrank();
        vm.prank(admin);
        pay.withdrawBudget(CO, admin, 1_000e6);
        assertEq(_co().budget, INIT_BUDGET - 1_000e6);
    }

    function test_DirectTokenTransfersAreNotCredited() public {
        usdc.mint(address(this), 50e6);
        usdc.transfer(address(pay), 50e6);
        assertEq(_co().budget, INIT_BUDGET);
        vm.prank(admin);
        vm.expectRevert(SalaryXPayroll.InsufficientAvailableBudget.selector);
        pay.withdrawBudget(CO, admin, uint128(INIT_BUDGET) + 1);
    }
}

/// @notice createBatch / executeBatch / cancelBatch behaviour.
contract SalaryXPayrollBatchTest is PayrollBase {
    uint64 internal constant LATER = NOW_TS + 1 days;

    // ───────────── createBatch: happy ─────────────
    function test_CreateBatch_AdminStoresBatchAndReserves() public {
        uint256 id = _create(admin, LATER, alice, 1_000e6);
        assertEq(id, 1);
        assertEq(pay.batchCount(), 1);
        assertEq(pay.nextBatchId(), 2);

        SalaryXPayroll.Batch memory b = pay.getBatch(id);
        assertEq(b.companyId, CO);
        assertEq(b.ref, REF);
        assertEq(b.executeAfter, LATER);
        assertEq(b.period, P_NOW);
        assertEq(b.total, 1_000e6);
        assertEq(b.creator, admin);
        assertEq(uint8(b.status), uint8(SalaryXPayroll.Status.Created));
        assertEq(b.count, 1);

        SalaryXPayroll.Payment[] memory ps = pay.getBatchPayments(id);
        assertEq(ps.length, 1);
        assertEq(ps[0].recipient, alice);
        assertEq(ps[0].amount, 1_000e6);

        assertEq(_co().reserved, 1_000e6);
        assertEq(_co().available, INIT_BUDGET - 1_000e6);
        assertEq(_co().budget, INIT_BUDGET, "budget untouched until execution");
        assertEq(pay.committedFor(CO, P_NOW), 1_000e6);
        assertTrue(pay.isScheduled(CO, P_NOW, alice));
    }

    function test_CreateBatch_ManagerIsCreator() public {
        uint256 id = _create(manager, LATER, alice, 1e6);
        assertEq(pay.getBatch(id).creator, manager);
    }

    function test_CreateBatch_EmitsPaymentScheduledAndBatchCreated() public {
        address[] memory rs = _a2(alice, bob);
        uint96[] memory as_ = _u2(100e6, 200e6);
        vm.expectEmit(true, true, false, true, address(pay));
        emit SalaryXPayroll.PaymentScheduled(1, alice, 100e6);
        vm.expectEmit(true, true, false, true, address(pay));
        emit SalaryXPayroll.PaymentScheduled(1, bob, 200e6);
        vm.expectEmit(true, true, true, true, address(pay));
        emit SalaryXPayroll.BatchCreated(1, CO, P_NOW, REF, LATER, 300e6, 2, manager);
        vm.prank(manager);
        pay.createBatch(CO, REF, LATER, rs, as_);
    }

    function test_CreateBatch_ExactlyMaxBatch() public {
        address[] memory rs = new address[](100);
        uint96[] memory as_ = new uint96[](100);
        for (uint256 i; i < 100; ++i) {
            rs[i] = address(uint160(0x1000 + i));
            as_[i] = 1e6;
        }
        vm.prank(admin);
        uint256 id = pay.createBatch(CO, REF, LATER, rs, as_);
        assertEq(pay.getBatch(id).count, 100);
        assertEq(pay.getBatch(id).total, 100e6);
    }

    function test_CreateBatch_AtMaxScheduleHorizon() public {
        uint256 id = _create(admin, NOW_TS + 366 days, alice, 1e6);
        assertEq(pay.getBatch(id).period, 202701);
    }

    function test_CreateBatch_SameRecipientDifferentPeriodAllowed() public {
        _create(admin, LATER, alice, 1e6);
        _create(admin, NOW_TS + 40 days, alice, 1e6); // 2026-02-24
        assertEq(pay.committedFor(CO, 202602), 1e6);
    }

    function test_CreateBatch_SameRecipientDifferentCompanyAllowed() public {
        vm.prank(bob);
        pay.registerCompany(CO2);
        vm.startPrank(bob);
        pay.setMonthlyAllowance(CO2, 10e6);
        usdc.mint(bob, 10e6);
        usdc.approve(address(pay), 10e6);
        pay.depositBudget(CO2, 10e6);
        pay.createBatch(CO2, REF, LATER, _a1(alice), _u1(1e6));
        vm.stopPrank();
        _create(admin, LATER, alice, 1e6);
        assertTrue(pay.isScheduled(CO2, P_NOW, alice));
        assertTrue(pay.isScheduled(CO, P_NOW, alice));
    }

    // ───────────── createBatch: reverts ─────────────
    function test_RevertWhen_ExecutorOrStrangerCreates() public {
        address[2] memory callers = [executor, stranger];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.Unauthorized.selector, callers[i]));
            pay.createBatch(CO, REF, LATER, _a1(alice), _u1(1e6));
        }
    }

    function test_RevertWhen_RemovedManagerCreates() public {
        vm.prank(admin);
        pay.setManager(CO, manager, false);
        vm.prank(manager);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.Unauthorized.selector, manager));
        pay.createBatch(CO, REF, LATER, _a1(alice), _u1(1e6));
    }

    function test_ExecutorWhoIsAlsoManagerCanCreate() public {
        vm.prank(admin);
        pay.setManager(CO, executor, true);
        _create(executor, LATER, alice, 1e6);
    }

    function test_RevertWhen_EmptyOrOversizedBatch() public {
        vm.startPrank(admin);
        vm.expectRevert(SalaryXPayroll.InvalidPaymentCount.selector);
        pay.createBatch(CO, REF, LATER, new address[](0), new uint96[](0));

        address[] memory rs = new address[](101);
        uint96[] memory as_ = new uint96[](101);
        for (uint256 i; i < 101; ++i) {
            rs[i] = address(uint160(0x1000 + i));
            as_[i] = 1;
        }
        vm.expectRevert(SalaryXPayroll.InvalidPaymentCount.selector);
        pay.createBatch(CO, REF, LATER, rs, as_);
        vm.stopPrank();
    }

    function test_RevertWhen_LengthMismatch() public {
        vm.prank(admin);
        vm.expectRevert(SalaryXPayroll.LengthMismatch.selector);
        pay.createBatch(CO, REF, LATER, _a2(alice, bob), _u1(1e6));
    }

    function test_RevertWhen_ScheduleTooFar() public {
        vm.prank(admin);
        vm.expectRevert(SalaryXPayroll.ScheduleTooFar.selector);
        pay.createBatch(CO, REF, NOW_TS + 366 days + 1, _a1(alice), _u1(1e6));
    }

    function test_RevertWhen_InvalidRecipientOrAmount() public {
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.InvalidRecipient.selector, address(0)));
        pay.createBatch(CO, REF, LATER, _a1(address(0)), _u1(1e6));
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.InvalidRecipient.selector, address(pay)));
        pay.createBatch(CO, REF, LATER, _a1(address(pay)), _u1(1e6));
        vm.expectRevert(SalaryXPayroll.InvalidAmount.selector);
        pay.createBatch(CO, REF, LATER, _a1(alice), _u1(0));
        vm.stopPrank();
    }

    function test_RevertWhen_DuplicateWithinBatch() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.RecipientAlreadyScheduled.selector, alice, P_NOW));
        pay.createBatch(CO, REF, LATER, _a2(alice, alice), _u2(1e6, 2e6));
    }

    function test_RevertWhen_DuplicateAcrossBatchesSamePeriod() public {
        _create(admin, LATER, alice, 1e6);
        vm.prank(manager);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.RecipientAlreadyScheduled.selector, alice, P_NOW));
        pay.createBatch(CO, REF, LATER + 3 days, _a1(alice), _u1(1e6));
    }

    function test_RevertWhen_AllowanceZero() public {
        vm.startPrank(admin);
        pay.setMonthlyAllowance(CO, 0);
        vm.expectRevert(SalaryXPayroll.AllowanceExceeded.selector);
        pay.createBatch(CO, REF, LATER, _a1(alice), _u1(1));
        vm.stopPrank();
    }

    function test_AllowanceCapIsPerPeriodAndInclusive() public {
        vm.prank(admin);
        pay.setMonthlyAllowance(CO, 1_000e6);
        _create(admin, LATER, alice, 600e6);

        vm.prank(admin);
        vm.expectRevert(SalaryXPayroll.AllowanceExceeded.selector);
        pay.createBatch(CO, REF, LATER, _a1(bob), _u1(400e6 + 1));

        _create(admin, LATER, bob, 400e6); // exactly at cap
        _create(admin, NOW_TS + 40 days, carol, 1_000e6); // next month has its own cap
        assertEq(pay.committedFor(CO, P_NOW), 1_000e6);
        assertEq(pay.committedFor(CO, 202602), 1_000e6);
    }

    function test_RevertWhen_InsufficientAvailableBudget() public {
        vm.prank(admin);
        vm.expectRevert(SalaryXPayroll.InsufficientAvailableBudget.selector);
        pay.createBatch(CO, REF, LATER, _a1(alice), _u1(uint96(INIT_BUDGET) + 1));
        assertEq(pay.batchCount(), 0, "failed create leaves no batch");
    }

    function test_RevertWhen_ReservationsExceedBudget() public {
        _create(admin, LATER, alice, 6_000e6);
        vm.prank(admin);
        vm.expectRevert(SalaryXPayroll.InsufficientAvailableBudget.selector);
        pay.createBatch(CO, REF, NOW_TS + 40 days, _a1(bob), _u1(4_000e6 + 1));
        _create(admin, NOW_TS + 40 days, bob, 4_000e6); // exactly the rest
        assertEq(_co().available, 0);
    }

    function test_RevertWhen_CreatePaused() public {
        vm.prank(owner);
        pay.pause();
        vm.prank(admin);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        pay.createBatch(CO, REF, LATER, _a1(alice), _u1(1e6));
    }

    function test_RevertWhen_CreateSuspendedOrUnknown() public {
        vm.prank(owner);
        pay.setCompanyActive(CO, false);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.CompanyInactive.selector, CO));
        pay.createBatch(CO, REF, LATER, _a1(alice), _u1(1e6));

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.UnknownCompany.selector, CO2));
        pay.createBatch(CO2, REF, LATER, _a1(alice), _u1(1e6));
    }

    // ───────────── executeBatch ─────────────
    function _executeAs(address caller) internal {
        uint256 id = _create(admin, LATER, alice, 300e6);
        vm.warp(LATER);
        vm.prank(caller);
        pay.executeBatch(id);
        assertEq(uint8(pay.getBatch(id).status), uint8(SalaryXPayroll.Status.Executed));
        assertEq(usdc.balanceOf(alice), 300e6);
        assertEq(_co().budget, INIT_BUDGET - 300e6);
        assertEq(_co().reserved, 0);
        assertEq(usdc.balanceOf(address(pay)), INIT_BUDGET - 300e6);
    }

    function test_Execute_ByAdmin() public { _executeAs(admin); }
    function test_Execute_ByManager() public { _executeAs(manager); }
    function test_Execute_ByExecutor() public { _executeAs(executor); }

    function test_Execute_EmitsEventsAndPaysAll() public {
        address[] memory rs = _a2(alice, bob);
        uint96[] memory as_ = _u2(100e6, 250e6);
        vm.prank(admin);
        uint256 id = pay.createBatch(CO, REF, LATER, rs, as_);
        vm.warp(LATER);

        vm.expectEmit(true, true, true, true, address(pay));
        emit SalaryXPayroll.SalaryPaid(id, CO, alice, 100e6, P_NOW);
        vm.expectEmit(true, true, true, true, address(pay));
        emit SalaryXPayroll.SalaryPaid(id, CO, bob, 250e6, P_NOW);
        vm.expectEmit(true, true, false, true, address(pay));
        emit SalaryXPayroll.BatchExecuted(id, CO, 350e6, 2, executor);
        vm.prank(executor);
        pay.executeBatch(id);

        assertEq(usdc.balanceOf(alice), 100e6);
        assertEq(usdc.balanceOf(bob), 250e6);
    }

    function test_Execute_ExactlyAtExecuteAfter() public {
        uint256 id = _create(admin, LATER, alice, 1e6);
        vm.warp(LATER - 1);
        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.BatchNotDue.selector, id));
        pay.executeBatch(id);
        vm.warp(LATER);
        vm.prank(executor);
        pay.executeBatch(id);
    }

    function test_Execute_BackdatedBatchUsesPastPeriodAndRunsImmediately() public {
        uint64 past = NOW_TS - 100 days; // 2025-10-07
        uint256 id = _create(admin, past, alice, 5e6);
        assertEq(pay.getBatch(id).period, 202510);
        assertEq(pay.committedFor(CO, 202510), 5e6);
        vm.expectEmit(true, true, true, true, address(pay));
        emit SalaryXPayroll.SalaryPaid(id, CO, alice, 5e6, 202510);
        vm.prank(executor);
        pay.executeBatch(id);
        assertEq(usdc.balanceOf(alice), 5e6);
    }

    function test_RevertWhen_ExecuteTwiceOrUnknown() public {
        uint256 id = _create(admin, NOW_TS, alice, 1e6);
        vm.prank(executor);
        pay.executeBatch(id);
        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.InvalidBatchStatus.selector, id));
        pay.executeBatch(id);
        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.InvalidBatchStatus.selector, 99));
        pay.executeBatch(99);
    }

    function test_RevertWhen_ExecuteCancelled() public {
        uint256 id = _create(admin, NOW_TS, alice, 1e6);
        vm.prank(admin);
        pay.cancelBatch(id);
        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.InvalidBatchStatus.selector, id));
        pay.executeBatch(id);
    }

    function test_RevertWhen_UnauthorizedExecutes() public {
        uint256 id = _create(admin, NOW_TS, alice, 1e6);
        address[2] memory callers = [stranger, owner];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.Unauthorized.selector, callers[i]));
            pay.executeBatch(id);
        }
    }

    function test_RevertWhen_RemovedManagerOrReplacedExecutorExecutes() public {
        uint256 id = _create(admin, NOW_TS, alice, 1e6);
        vm.startPrank(admin);
        pay.setManager(CO, manager, false);
        pay.setExecutor(CO, bob);
        vm.stopPrank();
        vm.prank(manager);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.Unauthorized.selector, manager));
        pay.executeBatch(id);
        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.Unauthorized.selector, executor));
        pay.executeBatch(id);
        vm.prank(bob);
        pay.executeBatch(id);
    }

    function test_RevertWhen_ExecutePausedThenWorksAfterUnpause() public {
        uint256 id = _create(admin, NOW_TS, alice, 1e6);
        vm.prank(owner);
        pay.pause();
        vm.prank(executor);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        pay.executeBatch(id);
        vm.prank(owner);
        pay.unpause();
        vm.prank(executor);
        pay.executeBatch(id);
        assertEq(usdc.balanceOf(alice), 1e6);
    }

    function test_RevertWhen_ExecuteSuspendedThenWorksAfterReactivation() public {
        uint256 id = _create(admin, NOW_TS, alice, 1e6);
        vm.prank(owner);
        pay.setCompanyActive(CO, false);
        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.CompanyInactive.selector, CO));
        pay.executeBatch(id);
        vm.prank(owner);
        pay.setCompanyActive(CO, true);
        vm.prank(executor);
        pay.executeBatch(id);
    }

    function test_LoweringAllowanceDoesNotInvalidateExistingBatch() public {
        uint256 id = _create(admin, NOW_TS, alice, 1e6);
        vm.prank(admin);
        pay.setMonthlyAllowance(CO, 0);
        vm.prank(executor);
        pay.executeBatch(id);
        assertEq(usdc.balanceOf(alice), 1e6);
    }

    function test_ExecutedCommitmentAndRecipientFlagPersist() public {
        uint256 id = _create(admin, NOW_TS, alice, 1e6);
        vm.prank(executor);
        pay.executeBatch(id);
        assertEq(pay.committedFor(CO, P_NOW), 1e6);
        assertTrue(pay.isScheduled(CO, P_NOW, alice));
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.RecipientAlreadyScheduled.selector, alice, P_NOW));
        pay.createBatch(CO, REF, NOW_TS, _a1(alice), _u1(1e6));
        assertEq(pay.getBatchPayments(id).length, 1, "payments retained");
    }

    function test_ExecutorCannotWithdrawOrChangeRoles() public {
        vm.startPrank(executor);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.Unauthorized.selector, executor));
        pay.withdrawBudget(CO, executor, 1e6);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.Unauthorized.selector, executor));
        pay.setManager(CO, executor, true);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.Unauthorized.selector, executor));
        pay.setMonthlyAllowance(CO, type(uint128).max);
        vm.stopPrank();
    }

    // ───────────── cancelBatch ─────────────
    function test_Cancel_ByAdminReleasesReservationAndFlags() public {
        uint256 id = _create(admin, LATER, alice, 700e6);
        vm.expectEmit(true, true, false, true, address(pay));
        emit SalaryXPayroll.BatchCancelled(id, CO, admin);
        vm.prank(admin);
        pay.cancelBatch(id);

        assertEq(uint8(pay.getBatch(id).status), uint8(SalaryXPayroll.Status.Cancelled));
        assertEq(_co().reserved, 0);
        assertEq(_co().available, INIT_BUDGET);
        assertEq(pay.committedFor(CO, P_NOW), 0);
        assertFalse(pay.isScheduled(CO, P_NOW, alice));
        assertEq(pay.getBatchPayments(id).length, 1, "payments retained");
        assertEq(pay.batchCount(), 1, "count includes cancelled");

        // released funds are withdrawable and recipient can be rescheduled
        vm.prank(admin);
        pay.withdrawBudget(CO, admin, uint128(INIT_BUDGET));
        vm.prank(admin);
        pay.depositBudget(CO, 700e6);
        _create(admin, LATER, alice, 700e6);
    }

    function test_Cancel_ByManagerCreator() public {
        uint256 id = _create(manager, LATER, alice, 1e6);
        vm.prank(manager);
        pay.cancelBatch(id);
        assertEq(_co().reserved, 0);
    }

    function test_RevertWhen_OtherManagerExecutorStrangerOwnerCancels() public {
        vm.prank(admin);
        pay.setManager(CO, bob, true);
        uint256 id = _create(manager, LATER, alice, 1e6);
        address[4] memory callers = [bob, executor, stranger, owner];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.Unauthorized.selector, callers[i]));
            pay.cancelBatch(id);
        }
    }

    function test_RemovedManagerCreatorCannotCancelButAdminCan() public {
        uint256 id = _create(manager, LATER, alice, 1e6);
        vm.prank(admin);
        pay.setManager(CO, manager, false);
        vm.prank(manager);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.Unauthorized.selector, manager));
        pay.cancelBatch(id);
        vm.prank(admin);
        pay.cancelBatch(id);
    }

    function test_RevertWhen_CancelExecutedCancelledOrUnknown() public {
        uint256 id = _create(admin, NOW_TS, alice, 1e6);
        vm.prank(admin);
        pay.executeBatch(id);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.InvalidBatchStatus.selector, id));
        pay.cancelBatch(id);

        uint256 id2 = _create(admin, NOW_TS, bob, 1e6);
        vm.startPrank(admin);
        pay.cancelBatch(id2);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.InvalidBatchStatus.selector, id2));
        pay.cancelBatch(id2);
        vm.expectRevert(abi.encodeWithSelector(SalaryXPayroll.InvalidBatchStatus.selector, 77));
        pay.cancelBatch(77);
        vm.stopPrank();
    }

    function test_Cancel_WorksWhilePausedAndSuspended() public {
        uint256 id = _create(manager, LATER, alice, 1e6);
        uint256 id2 = _create(admin, LATER, bob, 1e6);
        vm.startPrank(owner);
        pay.pause();
        pay.setCompanyActive(CO, false);
        vm.stopPrank();
        vm.prank(manager);
        pay.cancelBatch(id);
        vm.prank(admin);
        pay.cancelBatch(id2);
        assertEq(_co().reserved, 0);
    }

    // ───────────── Fuzz ─────────────
    function testFuzz_BatchAccountingAndPayout(uint96 a, uint96 b) public {
        a = uint96(bound(a, 1, 5_000e6));
        b = uint96(bound(b, 1, 5_000e6));
        vm.prank(admin);
        uint256 id = pay.createBatch(CO, REF, NOW_TS, _a2(alice, bob), _u2(a, b));
        uint256 total = uint256(a) + b;
        assertEq(pay.getBatch(id).total, total);
        assertEq(_co().reserved, total);
        assertEq(_co().available, INIT_BUDGET - total);
        assertEq(pay.committedFor(CO, P_NOW), total);

        vm.prank(executor);
        pay.executeBatch(id);
        assertEq(usdc.balanceOf(alice), a);
        assertEq(usdc.balanceOf(bob), b);
        assertEq(_co().budget, INIT_BUDGET - total);
        assertEq(_co().reserved, 0);
        assertEq(usdc.balanceOf(address(pay)), INIT_BUDGET - total);
    }

    function testFuzz_AllowanceAndBudgetBoundary(uint128 allowance, uint96 amount) public {
        allowance = uint128(bound(allowance, 0, 20_000e6));
        amount = uint96(bound(amount, 1, 20_000e6));
        vm.startPrank(admin);
        pay.setMonthlyAllowance(CO, allowance);
        if (allowance == 0 || amount > allowance) {
            vm.expectRevert(SalaryXPayroll.AllowanceExceeded.selector);
        } else if (amount > INIT_BUDGET) {
            vm.expectRevert(SalaryXPayroll.InsufficientAvailableBudget.selector);
        }
        pay.createBatch(CO, REF, NOW_TS, _a1(alice), _u1(amount));
        vm.stopPrank();
    }

    function testFuzz_WithdrawBoundaryRespectsReservation(uint96 reserve, uint128 wd) public {
        reserve = uint96(bound(reserve, 0, INIT_BUDGET));
        wd = uint128(bound(wd, 1, INIT_BUDGET + 10e6));
        if (reserve > 0) _create(admin, LATER, alice, reserve);
        vm.prank(admin);
        if (wd > INIT_BUDGET - reserve) {
            vm.expectRevert(SalaryXPayroll.InsufficientAvailableBudget.selector);
            pay.withdrawBudget(CO, admin, wd);
        } else {
            pay.withdrawBudget(CO, admin, wd);
            assertEq(_co().budget, INIT_BUDGET - wd);
            assertEq(_co().reserved, reserve);
        }
    }

    function testFuzz_DepositWithdrawRoundTrip(uint128 amount) public {
        amount = uint128(bound(amount, 1, 900_000e6));
        uint256 balBefore = usdc.balanceOf(admin);
        vm.startPrank(admin);
        pay.depositBudget(CO, amount);
        pay.withdrawBudget(CO, admin, amount);
        vm.stopPrank();
        assertEq(usdc.balanceOf(admin), balBefore);
        assertEq(_co().budget, INIT_BUDGET);
    }

    function testFuzz_CancelRestoresState(uint96 amount) public {
        amount = uint96(bound(amount, 1, INIT_BUDGET));
        uint256 id = _create(manager, LATER, alice, amount);
        vm.prank(manager);
        pay.cancelBatch(id);
        assertEq(_co().reserved, 0);
        assertEq(_co().budget, INIT_BUDGET);
        assertEq(pay.committedFor(CO, P_NOW), 0);
        assertFalse(pay.isScheduled(CO, P_NOW, alice));
    }
}

/// @notice UTC month derivation from executeAfter.
contract SalaryXPayrollPeriodTest is PayrollBase {
    uint160 internal n;

    /// @dev Create a 1-wei batch scheduled at `ts` and return its derived period.
    function _p(uint64 ts) internal returns (uint32) {
        if (ts > block.timestamp) vm.warp(ts); // keep within the 366-day horizon
        ++n;
        uint256 id = _create(admin, ts, address(0x1000 + n), 1);
        return pay.getBatch(id).period;
    }

    function _isLeap(uint256 y) internal pure returns (bool) {
        return (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    }

    /// @dev Independent iterative reference implementation.
    function _ref(uint256 ts) internal pure returns (uint32) {
        uint256 d = ts / 86400;
        uint256 y = 1970;
        while (true) {
            uint256 yl = _isLeap(y) ? 366 : 365;
            if (d < yl) break;
            d -= yl;
            ++y;
        }
        uint8[12] memory dm = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        uint256 m;
        while (true) {
            uint256 len = dm[m];
            if (m == 1 && _isLeap(y)) len = 29;
            if (d < len) break;
            d -= len;
            ++m;
        }
        return uint32(y * 100 + m + 1);
    }

    function test_Period_EpochAndFirstMonthBoundary() public {
        assertEq(_p(0), 197001);
        assertEq(_p(2_678_399), 197001); // 1970-01-31 23:59:59
        assertEq(_p(2_678_400), 197002); // 1970-02-01
    }

    function test_Period_YearBoundaries() public {
        assertEq(_p(1_767_225_599), 202512); // 2025-12-31 23:59:59
        assertEq(_p(1_767_225_600), 202601); // 2026-01-01
        assertEq(_p(1_798_761_599), 202612);
        assertEq(_p(1_798_761_600), 202701);
    }

    function test_Period_LeapYearFebruary() public {
        assertEq(_p(951_782_400), 200002); // 2000-02-29 (divisible by 400 -> leap)
        assertEq(_p(951_868_800), 200003);
        assertEq(_p(1_709_164_800), 202402); // 2024-02-29
        assertEq(_p(1_709_251_199), 202402); // 2024-02-29 23:59:59
        assertEq(_p(1_709_251_200), 202403); // 2024-03-01
    }

    function test_Period_CenturyNonLeapYear2100() public {
        assertEq(_p(4_107_456_000), 210002); // 2100-02-28
        assertEq(_p(4_107_542_400), 210003); // 2100-03-01 (2100 is NOT a leap year)
    }

    function test_Period_BackdatedAndCurrent() public {
        assertEq(_p(NOW_TS), P_NOW);
        assertEq(_p(NOW_TS - 100 days), 202510);
        assertEq(_p(NOW_TS + 17 days), 202602);
    }

    function test_Period_SameMonthSharesCommitment() public {
        _create(admin, 1_767_225_600, alice, 10); // 2026-01-01
        _create(admin, 1_769_817_599, bob, 20); // 2026-01-30 23:59:59
        assertEq(pay.committedFor(CO, 202601), 30);
        assertEq(pay.committedFor(CO, 202602), 0);
    }

    function testFuzz_PeriodMatchesReference(uint64 ts) public {
        ts = uint64(bound(ts, 0, 4_200_000_000));
        uint32 p = _p(ts);
        assertEq(p, _ref(ts));
        assertGe(p % 100, 1);
        assertLe(p % 100, 12);
    }
}

/// @dev Bounded action surface for the invariant fuzzer. Acts as admin of two companies.
contract PayrollHandler is Test {
    SalaryXPayroll public pay;
    MockUSDC public usdc;
    address public owner;
    bytes32[2] public cos = [keccak256("h1"), keccak256("h2")];
    uint256[] public ids;

    uint256 public ghostDeposited;
    uint256 public ghostWithdrawn;
    uint256 public ghostPaid;

    constructor(SalaryXPayroll pay_, MockUSDC usdc_, address owner_) {
        pay = pay_;
        usdc = usdc_;
        owner = owner_;
        usdc.approve(address(pay), type(uint256).max);
        for (uint256 i; i < 2; ++i) {
            pay.registerCompany(cos[i]);
            pay.setMonthlyAllowance(cos[i], 1e12);
        }
    }

    function idsLength() external view returns (uint256) {
        return ids.length;
    }

    function deposit(uint256 ci, uint256 amt) external {
        bytes32 co = cos[ci % 2];
        amt = bound(amt, 1, 1e12);
        usdc.mint(address(this), amt);
        try pay.depositBudget(co, uint128(amt)) {
            ghostDeposited += amt;
        } catch {}
    }

    function withdraw(uint256 ci, uint256 amt) external {
        bytes32 co = cos[ci % 2];
        SalaryXPayroll.CompanyView memory c = pay.getCompany(co);
        amt = bound(amt, 1, uint256(c.available) + 1e6); // sometimes slightly too much
        try pay.withdrawBudget(co, address(this), uint128(amt)) {
            ghostWithdrawn += amt;
        } catch {}
    }

    function create(uint256 ci, uint256 seed, uint256 count, uint256 amt, uint256 offset) external {
        bytes32 co = cos[ci % 2];
        count = bound(count, 1, 4);
        uint64 when = uint64(block.timestamp - 30 days + bound(offset, 0, 120 days));
        address[] memory rs = new address[](count);
        uint96[] memory as_ = new uint96[](count);
        for (uint256 i; i < count; ++i) {
            rs[i] = address(uint160(0xA000 + ((seed + i) % 12)));
            as_[i] = uint96(bound(amt >> (i * 8), 1, 1e11));
        }
        try pay.createBatch(co, bytes32(seed), when, rs, as_) returns (uint256 id) {
            ids.push(id);
        } catch {}
    }

    function execute(uint256 idx) external {
        if (ids.length == 0) return;
        uint256 id = ids[idx % ids.length];
        uint128 total = pay.getBatch(id).total;
        try pay.executeBatch(id) {
            ghostPaid += total;
        } catch {}
    }

    function cancel(uint256 idx) external {
        if (ids.length == 0) return;
        try pay.cancelBatch(ids[idx % ids.length]) {} catch {}
    }

    function setAllowance(uint256 ci, uint256 amt) external {
        pay.setMonthlyAllowance(cos[ci % 2], uint128(bound(amt, 0, 1e12)));
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 0, 40 days));
    }

    function setPaused(bool p) external {
        vm.prank(owner);
        if (p) {
            try pay.pause() {} catch {}
        } else {
            try pay.unpause() {} catch {}
        }
    }

    function setSuspended(uint256 ci, bool s) external {
        vm.prank(owner);
        pay.setCompanyActive(cos[ci % 2], !s);
    }
}

contract SalaryXPayrollInvariantTest is PayrollBase {
    PayrollHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new PayrollHandler(pay, usdc, owner);
        targetContract(address(handler));
    }

    function _allCompanies() internal view returns (bytes32[3] memory a) {
        a[0] = CO;
        a[1] = handler.cos(0);
        a[2] = handler.cos(1);
    }

    /// reserved <= budget for every company
    function invariant_ReservedNeverExceedsBudget() public view {
        bytes32[3] memory cs = _allCompanies();
        for (uint256 i; i < 3; ++i) {
            SalaryXPayroll.CompanyView memory c = pay.getCompany(cs[i]);
            assertLe(c.reserved, c.budget);
            assertEq(c.available, c.budget - c.reserved);
        }
    }

    /// token balance >= sum of company budgets
    function invariant_BalanceCoversSumOfBudgets() public view {
        bytes32[3] memory cs = _allCompanies();
        uint256 sum;
        for (uint256 i; i < 3; ++i) sum += pay.getCompany(cs[i]).budget;
        assertGe(usdc.balanceOf(address(pay)), sum);
    }

    /// token balance matches deposits - withdrawals - payouts exactly
    function invariant_BalanceMatchesLedger() public view {
        uint256 expected = INIT_BUDGET + handler.ghostDeposited() - handler.ghostWithdrawn() - handler.ghostPaid();
        assertEq(usdc.balanceOf(address(pay)), expected);
    }

    /// reserved == sum of totals of batches still in Created status
    function invariant_ReservedEqualsOpenBatchTotals() public view {
        uint256 open0;
        uint256 open1;
        uint256 len = handler.idsLength();
        for (uint256 i; i < len; ++i) {
            SalaryXPayroll.Batch memory b = pay.getBatch(handler.ids(i));
            if (b.status != SalaryXPayroll.Status.Created) continue;
            if (b.companyId == handler.cos(0)) open0 += b.total;
            else open1 += b.total;
        }
        assertEq(pay.getCompany(handler.cos(0)).reserved, open0);
        assertEq(pay.getCompany(handler.cos(1)).reserved, open1);
    }
}
