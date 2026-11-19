# SalaryX

> Built with Arc Studio - money-powered apps in minutes

Project memory for future agents and humans.

## What This App Does

SalaryX is a global payroll platform on Arc Testnet. A company prefunds a USDC budget in the SalaryXPayroll contract, sets a monthly allowance, managers queue payroll batches in advance, and an authorized keeper wallet releases due batches. Employees get a portal with payment history and PDF payslips.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS, React Router, Recharts, React Hook Form + Zod, jsPDF, PapaParse
- Web3: wagmi v2, viem v2, ConnectKit (injected wallet)
- Contracts: Solidity 0.8.28 + Foundry. `contracts/SalaryXPayroll.sol`, tests in `contracts/test/SalaryXPayroll.t.sol`
- Chain: Arc Testnet (5042002). USDC ERC-20 view (6 decimals) at the predeploy address; always read it from `@/onchain-facts`
- Data: `src/lib/store.ts` is a synchronous cache with write-through. With `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` set it loads from Supabase (RLS-filtered, memory only) and pushes every write through `src/lib/remote.ts`; without them it falls back to browser localStorage (demo).

## Deployed contracts

- SalaryXPayroll on Arc Testnet: `0x4781bf11f626ce4c6092ffd29dc542577f3c9dbb`, owner is the platform deployer wallet (can pause, suspend companies, toggle registration; cannot touch budgets). Address is in `.env` as `VITE_PAYROLL_CONTRACT`.

## Key Files

- `src/lib/chain.ts` contract writes, log verification and reads. `src/lib/tx.ts` records every action; a tx is `success` only after receipt + event verification.
- `src/lib/actions.ts` queue, execute and cancel payroll. `src/hooks/useChain.ts` syncs queued payrolls with contract state (the keeper pays without the app open).
- `src/lib/auth.tsx` Supabase Auth when configured (roles assigned by the `handle_new_user` trigger in `0003_auth.sql`), else demo email auth. `src/lib/supabase.ts` holds the client and mode switch. Platform admins are promoted by SQL only.
- `src/lib/rates.ts` display-only exchange rates. Settlement is always USDC.
- `scripts/keeper.ts` standalone executor, run off-sandbox with `KEEPER_PRIVATE_KEY` from env.
- `src/pages/*` one file per screen. `src/components/ui.tsx` primitives.

## Rules to keep

- Never mark a payment successful before the receipt is confirmed and events match. Simulated actions are DEMO.
- Contract rule: one payment per wallet per calendar month (UTC), derived from the batch pay date. Daily and weekly schedules are reminders and drafts only.
- Employee-submitted wallets stay `pending` until a manager or admin approves them. Only approved wallets are paid.
- No personal data onchain. Never put the keeper key or Supabase service-role key in `src/`.
- Do not call `Date.now()` in components; use `nowMs()` / `useNow()` from `@/lib/utils` (the linter's purity rule).
- Share links: use `buildShareLink` from `src/lib/share.ts`; keep `installShareSync()` in `src/main.tsx`.

## To Run

```bash
bun install
bun run dev
bun run check
```
