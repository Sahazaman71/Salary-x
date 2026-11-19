## Implementation Plan: SalaryX

### Summary
SalaryX is a global payroll dashboard on Arc Testnet. A company admin or payroll manager prefunds a USDC budget and sets a monthly allowance. Managers create each month's payroll in advance, and an authorized backend wallet (keeper) releases it on schedule. The contract caps every release at the prepaid budget and the monthly allowance. All 15 pages are in this build, with lighter polish on admin, reports and settings.

### Decisions and deviations from the brief
- Stack: Vite + React + TypeScript + Tailwind with wagmi and ConnectKit (Next.js, Reown AppKit, shadcn/ui and a live Supabase project are not available in this workspace). React Router, own UI primitives in shadcn style. App data lives in the browser behind a repository layer that mirrors the DB tables. Supabase SQL schema + RLS ship in supabase/ for later.
- Email login is demo-grade: accounts and role checks live in the browser, not real security. The UI says so. Real auth comes with Supabase + RLS. Money rules are enforced on-chain.
- Roles: Company Admin (email signup, registers company on-chain, adds manager and employee wallets); Payroll Manager (invited by admin by email); Employee (email login, manually submits own wallet; admin/manager must approve before it can be paid; any change needs re-approval); Platform Admin (VITE_PLATFORM_ADMIN_EMAILS).
- Automatic execution: standalone scripts/keeper.ts run on the user's own server/cron with KEEPER_PRIVATE_KEY from env only. The contract only lets the keeper release batches a manager already created and reserved, after their due date, within the allowance. A leaked keeper key cannot redirect funds or exceed the cap.
- Currencies USD, EUR, GBP, BDT, INR, PHP, AUD are display estimates only (rates from open.er-api.com, build agent to confirm coverage; cached with timestamp). Settlement is always USDC on Arc. No claim of local bank payouts.
- Payment is "Success" only after on-chain receipt + log verification. With no contract configured, Demo mode runs and every simulated tx carries a DEMO badge.

### Architecture
- Blockchain: Arc Testnet (chain ID 5042002). USDC native gas token, 6-decimal ERC-20 view at the predeploy 0x3600000000000000000000000000000000000000. Chain, USDC, explorer values come from @/onchain-facts. Show one USDC balance, never native + ERC-20.
- Contract: SalaryXPayroll.sol, OpenZeppelin 5 AccessControl, ReentrancyGuard, Pausable, SafeERC20.
  - Companies keyed by bytes32 companyId. registerCompany makes caller company admin. Admin sets managers and one executor (keeper).
  - depositBudget(companyId, amount) pulls USDC after approve. withdrawBudget admin-only, unreserved funds only.
  - setMonthlyAllowance(companyId, amount) admin-only; caps total reserved/released per month.
  - createBatch(companyId, periodKey, ref, recipients[], amounts[], executeAfter) by manager/admin: reserves budget + allowance, rejects duplicate recipients in batch, max 100 recipients, status Created.
  - executeBatch(batchId) by executor or manager once executeAfter passed: SafeERC20 payouts, atomic, nonReentrant, status Executed.
  - cancelBatch releases reservation.
  - Duplicate protection: paid[company][periodKey][recipient] mapping + one-time execution status.
  - Events: CompanyRegistered, BudgetDeposited, BudgetWithdrawn, AllowanceSet, BatchCreated, BatchExecuted, BatchCancelled, SalaryPaid.
  - Only addresses, amounts and an opaque ref hash on-chain. No personal data. Platform owner can pause. A blocklisted recipient reverts a batch: manager cancels and recreates without that wallet.
- Frontend: React Router, Recharts, React Hook Form + Zod, jspdf for payslips/PDF reports, PapaParse for CSV. Pages: Landing, Auth, Dashboard, Employees, Add Employee, Payroll, Bulk Pay, Schedules, History, Transaction, Employee Portal, Payslip, Reports, Settings, Platform Admin. Navy/electric-blue on white, responsive sidebar, loading/empty/error states, confirm dialogs before payments.
- Wallet: ConnectKit injected connector on Arc Testnet; chain guard before every tx; faucet link (faucet.circle.com).
- Verification: waitForTransactionReceipt, then cross-check SalaryPaid and BatchExecuted logs against expected recipients and amounts before setting local status.

### Files to Create/Modify
1. contracts/SalaryXPayroll.sol - the contract above.
2. contracts/test/SalaryXPayroll.t.sol - Foundry tests: budget caps, allowance, duplicates, roles, timing, reentrancy.
3. contracts/design/SalaryXPayroll.md - short design doc: roles, threat model, keeper trust boundary.
4. package.json - add react-router-dom, recharts, react-hook-form, zod, @hookform/resolvers, jspdf, jspdf-autotable, papaparse; add keeper script.
5. src/config.ts - keep Arc Testnet + wagmi, explicit Arc RPC.
6. src/main.tsx - ConnectKit, React Query, router, Sonner; keep installShareSync().
7. src/App.tsx - route table with role-guarded layouts.
8. src/contracts/salaryx.ts - ABI, deployed address from env, typed helpers.
9. src/lib/types.ts - domain types mirroring DB tables.
10. src/lib/store.ts - localStorage repository for profiles, companies, members, employees, payrolls, items, transactions, schedules, rates, audit logs.
11. src/lib/auth.tsx - demo email auth (PBKDF2), sessions, role context.
12. src/lib/rates.ts - exchange-rate fetch, cache, conversion estimates.
13. src/lib/payroll.ts - totals, validation, period keys, duplicate checks, batch building.
14. src/lib/chain.ts - chain guard, receipt + log verification, explorer links via @/onchain-facts.
15. src/lib/csv.ts and src/lib/pdf.ts - employee CSV import, report exports, payslip PDFs.
16. src/lib/audit.ts - audit log writer.
17. src/components/ui/* - Button, Card, Input, Select, Dialog, Table, Badge, Tabs, Skeleton, EmptyState, ConfirmDialog.
18. src/components/layout/* - AppShell, Sidebar, Topbar, MobileNav.
19. src/components/* - StatCard, charts, TxStatusBadge (with DEMO), WalletBadge, CurrencySwitcher, EstimateNotice.
20. src/pages/Landing.tsx - hero, how it works, features, benefits, Arc integration, security, FAQ, CTA, footer.
21. src/pages/Auth.tsx - login/registration with demo-auth disclosure.
22. src/pages/Dashboard.tsx - KPIs, charts, recent transactions, upcoming payroll, budget gauge.
23. src/pages/Employees.tsx and src/pages/AddEmployee.tsx - list, edit, remove, CSV import, wallet approval queue.
24. src/pages/Payroll.tsx - draft, review, approve, create on-chain batch.
25. src/pages/BulkPay.tsx - deposit/budget funding, monthly allowance, manual execute.
26. src/pages/Schedules.tsx - daily/weekly/monthly schedules, reminders, keeper status from events.
27. src/pages/History.tsx and src/pages/TransactionDetail.tsx - filters, hash, explorer link, verification result.
28. src/pages/EmployeePortal.tsx and src/pages/Payslip.tsx - personal dashboard, wallet submission, payment verification, PDF download.
29. src/pages/Reports.tsx - monthly, country, salary stats; CSV and PDF export.
30. src/pages/Settings.tsx - company profile, wallet roles, default currency, manager invites.
31. src/pages/PlatformAdmin.tsx - companies, platform totals, audit log (lighter polish).
32. scripts/keeper.ts - standalone executor: scans BatchCreated, executes due batches.
33. supabase/migrations/0001_schema.sql - 10 tables with foreign keys and indexes.
34. supabase/migrations/0002_rls.sql - RLS for company admin, manager, employee, platform admin.
35. .env.example - VITE_PAYROLL_CONTRACT, VITE_PLATFORM_ADMIN_EMAILS, KEEPER_PRIVATE_KEY (keeper only), ARC_TESTNET_RPC_URL, Supabase placeholders.
36. README.md - install, contract deploy, keeper setup, Supabase setup, security notes, demo limits.
37. AGENTS.md - update project memory.

### Build Sequence
1. Write SalaryXPayroll.sol and design doc, write tests, run security review.
2. Fix findings, deploy to Arc Testnet, record address in .env.
3. Add dependencies and Tailwind theme; router, providers, ConnectKit chain guard.
4. Domain types, localStorage repository, audit logging, demo auth, role guards.
5. UI primitives, app shell, landing page.
6. Auth pages, dashboard, employee list/add/CSV import, wallet approval flow.
7. Exchange rates and currency switcher with "estimate only, settles in USDC" notice.
8. Budget funding and allowance page (approve + deposit).
9. Payroll page: select, review, confirm, createBatch; manual execute with receipt + log verification; DEMO labeling.
10. Schedules page and scripts/keeper.ts; test one due batch end to end.
11. History, transaction detail, employee portal, PDF payslip.
12. Reports and exports, settings, platform admin.
13. Supabase migrations + RLS, .env.example, README.
14. Polish loading/empty/error states and mobile; lint, typecheck, full preview test.

### Done When
- [ ] Contract deployed on Arc Testnet; tests pass; total reserved/released per month never exceeds allowance or deposited budget.
- [ ] A batch cannot pay the same recipient twice for one period or execute twice.
- [ ] Executor can only execute due, pre-created batches; cannot create batches, withdraw or change recipients.
- [ ] Admin can register a company, fund budget, set allowance, add manager wallets.
- [ ] Employees log in by email, submit a wallet, and are paid only after approval.
- [ ] Success shown only after on-chain confirmation, with hash and explorer link; simulated txs carry a DEMO badge.
- [ ] CSV import works, PDF payslips download, reports export as CSV and PDF.
- [ ] All 15 pages reachable and responsive; demo-auth and currency-estimate disclosures visible.
- [ ] scripts/keeper.ts runs against testnet using only env vars; no secret in src/.
- [ ] Supabase SQL files, .env.example and README included.

## Ready to build?
