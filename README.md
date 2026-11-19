# SalaryX

Global payroll on Arc. A company prefunds a USDC budget, sets a monthly allowance, queues salaries once, and an automation wallet pays them on schedule. Every payment is verified onchain before it is shown as paid.

Built with [Arc Studio](https://studio.arc.io)

## What you can do

- Company admins and payroll managers manage employees (including CSV import), approve employee wallets, create and approve payrolls, fund the budget and schedule monthly payments.
- Employees sign in, submit their payout wallet, see payment history, verify payments and download PDF payslips.
- Platform admins see all companies and activity.
- Salaries can be displayed in USD, EUR, GBP, BDT, INR, PHP and AUD. These are estimates. Settlement is always USDC on Arc. SalaryX does not pay out to local bank accounts.
- Demo mode simulates payments without sending anything onchain. Simulated items are always labelled DEMO.

## Tech stack

React, TypeScript, Vite, Tailwind CSS, wagmi, viem, ConnectKit, Recharts, React Hook Form, Zod. Solidity contract built with OpenZeppelin and Foundry. Arc Testnet (chain ID 5042002), USDC.

## Important limits of this build

- Without Supabase configured, sign-in is a browser-only demo, so roles are not a security boundary and the app shows a notice. With Supabase configured (see "Real accounts and data" below) the app uses Supabase Auth and Postgres with row level security. In both modes the payment rules are enforced by the contract.
- One payment per wallet per calendar month. Daily and weekly schedules create reminders and drafts, and only monthly schedules can be queued onchain.
- The contract has not had an independent audit. Get one before using real funds.

## Development

Prerequisites: [Bun](https://bun.sh), a browser wallet (for example MetaMask), and test USDC for Arc Testnet from https://faucet.circle.com.

```bash
bun install
cp .env.example .env   # then fill in the values below
bun run dev
```

Other commands: `bun run check` (lint and typecheck), `bun run contracts:build`, `bun run contracts:test`.

### Environment variables

- `VITE_PAYROLL_CONTRACT`: address of the deployed SalaryXPayroll contract on Arc Testnet.
- `VITE_PLATFORM_ADMIN_EMAILS`: demo mode only. Emails that become Platform Admin when they register. Ignored when Supabase is configured.
- `KEEPER_PRIVATE_KEY`: private key of the automation wallet. Used only by the keeper script, never by the browser. Never commit it.
- `ARC_TESTNET_RPC_URL`: optional RPC for the keeper. Defaults to the public Arc Testnet RPC.
- `KEEPER_STATE_FILE`: optional path for the keeper's progress file.
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`: your Supabase project URL and public anon key. When both are set the app uses real accounts and stores data in Supabase.
- `SUPABASE_SERVICE_ROLE_KEY`: not used by this app. Never put it in the browser or in a `VITE_` variable.

Restart the dev server after changing `.env`.

## Deploy the contract

```bash
bun run contracts:build
bun run contracts:test
```

Deploy `contracts/SalaryXPayroll.sol` with two constructor arguments: the Arc Testnet USDC address (`0x3600000000000000000000000000000000000000`) and the address that will own the contract (it can pause the contract and suspend companies; it cannot touch company budgets). Put the deployed address in `VITE_PAYROLL_CONTRACT`.

## First run

1. Register a company, connect your wallet, then open Budget & payments and register the company onchain.
2. Deposit test USDC and set a monthly allowance.
3. Add employees. Employees register with the same email and submit their wallet. You approve it.
4. Create a payroll, approve it, and queue it. The contract reserves the money for the pay date.
5. A due batch is paid by the keeper, or by you with "Pay now".

## Automatic payment (keeper)

1. Create a new wallet for the keeper and fund it with a little test USDC for gas.
2. In Budget & payments, set that wallet as the keeper.
3. Run the keeper on your own server or cron:

```bash
KEEPER_PRIVATE_KEY=0x... VITE_PAYROLL_CONTRACT=0x... bun run keeper            # one pass
KEEPER_PRIVATE_KEY=0x... VITE_PAYROLL_CONTRACT=0x... bun run keeper -- --watch # every 60 seconds
```

The keeper can only release batches your managers already queued, after their pay date. It cannot create batches, change recipients or amounts, or withdraw funds.

## Real accounts and data (Supabase)

1. Create a Supabase project. In the SQL editor run, in order, `supabase/migrations/0001_schema.sql`, `0002_rls.sql` and `0003_auth.sql`.
2. In Authentication, enable Email sign-in and keep "Confirm email" on. Set the Site URL to your app's address and add it to the redirect URLs.
3. Put the project URL and anon key in `.env` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then restart the dev server (or set them in your host's environment).
4. Promote your first Platform Admin by hand in the SQL editor: `update public.profiles set role = 'platform_admin', company_id = null where email = 'you@example.com';`

How it stays safe:
- Roles are assigned by a database trigger at sign-up, never by the browser. A new company admin can only create their own company. Managers and employees can only register with an email that a company admin already invited or added.
- Row level security limits every table to the right company and role. Employees can read only their own record and their own paid payrolls, and can change nothing except submitting a wallet, which goes back to "pending" until a manager approves it.
- No browser session data is kept in local storage in this mode, and everything is cleared on sign-out.
- Audit logs cannot be edited or deleted by users.

What is still your job before real money:
- Payroll and payment records are written by the signed-in manager's browser as a mirror of what happens onchain. The contract is the source of truth, and employees can verify any payment against it. If you need records that managers cannot alter, add a server job (for example a Supabase Edge Function using the service-role key, kept server-side) that reads the contract and writes the executed status and transaction rows.
- Run the keeper as a scheduled job with its key in a secrets manager, fund it with a small gas balance, and alert on failures.
- Get an independent audit of `contracts/SalaryXPayroll.sol`, deploy it from your own wallet with a multisig owner, and use a dedicated RPC provider.
- Paying salaries is regulated. Plan for KYC/KYB, tax reporting and data-protection rules in the countries you operate in. Local bank payouts need a licensed payment partner.

## Deployment

The app is a static Vite build (`bun run build`). Host it on any static host with a fallback to `index.html` for client routes. Set `VITE_PAYROLL_CONTRACT` in the host's environment. Run the keeper separately on a server you control.

## Mainnet

This build targets Arc Testnet only. Moving to mainnet needs your own independent review, audit and deployment.
