# SalaryXPayroll design notes

## Goal
Prefunded USDC payroll. A company admin deposits a budget and sets a monthly allowance. Managers create batches in advance. A keeper wallet releases due batches. The contract enforces the budget, the allowance and one payment per wallet per month.

## Roles
- Platform owner (Ownable2Step): pause or unpause, suspend or reactivate a company, open or close registration. Cannot withdraw company funds. Ownership renouncing is disabled so a pause can always be lifted.
- Company admin: sets managers, the executor (keeper) and the allowance, withdraws unreserved budget, cancels any batch, transfers admin in two steps.
- Manager: creates batches, executes due batches, cancels batches they created.
- Executor (keeper): executes due batches only.

## Money flow
`depositBudget` pulls USDC. `createBatch` reserves budget and monthly allowance and marks each recipient as scheduled for that UTC month. `executeBatch` pays out atomically after `executeAfter`. `cancelBatch` releases the reservation. `withdrawBudget` and `cancelBatch` work while paused or suspended so funds are never trapped.

## Threat model
- Leaked keeper key: can only execute batches that managers already created and only after their date. Cannot change recipients or amounts, create batches or withdraw.
- Malicious manager: bounded by the monthly allowance and by the unreserved budget; the admin can cancel their batches and remove them.
- Reentrancy: state is updated before transfers and execution is non-reentrant.
- Blocklisted recipient: USDC can revert for a blocked address and revert the whole batch. The manager cancels and recreates the batch without that wallet.
- Privacy: only addresses, amounts and an opaque reference are stored.

## Known limits
- Allowance is counted per scheduled month, not per execution month. Lowering the allowance does not cancel batches that already exist.
- One payment per wallet per month. Bonuses in the same month need a different wallet or the next month.
- Not independently audited.
