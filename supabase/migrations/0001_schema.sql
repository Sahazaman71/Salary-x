-- SalaryX schema. Run in the Supabase SQL editor, or with `supabase db push`.
-- Money is stored as numeric(38,6): USDC decimal amounts with 6 decimals.
-- No personal data is ever written onchain; names and emails live only in these tables.

create extension if not exists pgcrypto;

create type public.app_role as enum ('company_admin', 'payroll_manager', 'employee', 'platform_admin');
create type public.currency_code as enum ('USD', 'EUR', 'GBP', 'BDT', 'INR', 'PHP', 'AUD');
create type public.wallet_status as enum ('none', 'pending', 'approved');
create type public.employee_status as enum ('active', 'inactive', 'invited');
create type public.payroll_status as enum ('draft', 'approved', 'queued', 'executed', 'cancelled', 'failed');
create type public.tx_kind as enum (
  'register_company', 'deposit', 'withdraw', 'set_allowance', 'set_manager', 'set_executor',
  'batch_create', 'batch_execute', 'batch_cancel'
);
create type public.tx_status as enum ('pending', 'success', 'failed', 'demo');
create type public.frequency as enum ('daily', 'weekly', 'monthly');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role public.app_role not null default 'employee',
  company_id uuid,
  created_at timestamptz not null default now()
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country text not null,
  default_currency public.currency_code not null default 'USD',
  owner_id uuid not null references public.profiles (id),
  -- bytes32 id used by the SalaryXPayroll contract, as 0x + 64 hex chars
  onchain_id text not null unique check (onchain_id ~ '^0x[0-9a-fA-F]{64}$'),
  created_at timestamptz not null default now()
);

alter table public.profiles
  add constraint profiles_company_fk foreign key (company_id) references public.companies (id) on delete set null;

create table public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  email text not null,
  role public.app_role not null check (role in ('company_admin', 'payroll_manager')),
  wallet text check (wallet is null or wallet ~ '^0x[0-9a-fA-F]{40}$'),
  created_at timestamptz not null default now(),
  unique (company_id, email)
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  name text not null,
  email text not null,
  country text not null,
  wallet text check (wallet is null or wallet ~ '^0x[0-9a-fA-F]{40}$'),
  wallet_status public.wallet_status not null default 'none',
  salary_amount numeric(38, 6) not null check (salary_amount > 0),
  currency public.currency_code not null default 'USD',
  status public.employee_status not null default 'invited',
  created_at timestamptz not null default now(),
  unique (company_id, email)
);

create table public.payrolls (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  title text not null,
  period integer not null check (period between 200001 and 999912), -- YYYYMM, UTC
  execute_after timestamptz not null,
  status public.payroll_status not null default 'draft',
  total_usdc numeric(38, 6) not null check (total_usdc >= 0),
  onchain_batch_id numeric(78, 0),
  demo boolean not null default false,
  schedule_id uuid,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.payroll_items (
  id uuid primary key default gen_random_uuid(),
  payroll_id uuid not null references public.payrolls (id) on delete cascade,
  employee_id uuid not null references public.employees (id),
  wallet text not null check (wallet ~ '^0x[0-9a-fA-F]{40}$'),
  amount_usdc numeric(38, 6) not null check (amount_usdc > 0),
  display_amount numeric(38, 2) not null,
  display_currency public.currency_code not null,
  unique (payroll_id, employee_id)
);

create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  payroll_id uuid references public.payrolls (id) on delete set null,
  kind public.tx_kind not null,
  hash text check (hash is null or hash ~ '^0x[0-9a-fA-F]{64}$'),
  status public.tx_status not null default 'pending',
  amount_usdc numeric(38, 6) not null default 0,
  block_number numeric(78, 0),
  verified boolean not null default false,
  error text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  -- a transaction is only successful once it carries a hash, except explicit demo rows
  check (status <> 'success' or hash is not null or kind = 'batch_execute')
);

create table public.payroll_schedules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  frequency public.frequency not null,
  anchor smallint not null default 1,
  active boolean not null default true,
  employee_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.payrolls
  add constraint payrolls_schedule_fk foreign key (schedule_id) references public.payroll_schedules (id) on delete set null;

create table public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  base public.currency_code not null default 'USD',
  quote public.currency_code not null,
  rate numeric(24, 8) not null check (rate > 0),
  fetched_at timestamptz not null default now(),
  unique (base, quote, fetched_at)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete set null,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_email text not null,
  action text not null,
  entity text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);

-- Indexes for the common lookups and for RLS helper functions.
create index on public.profiles (company_id);
create index on public.company_members (company_id);
create index on public.company_members (profile_id);
create index on public.employees (company_id);
create index on public.employees (profile_id);
create index on public.employees (lower(email));
create index on public.payrolls (company_id, period);
create index on public.payrolls (company_id, status);
create index on public.payroll_items (payroll_id);
create index on public.payroll_items (employee_id);
create index on public.payment_transactions (company_id, created_at desc);
create index on public.payment_transactions (payroll_id);
create unique index payment_transactions_hash_kind on public.payment_transactions (hash, kind, payroll_id) where hash is not null;
create index on public.payroll_schedules (company_id);
create index on public.exchange_rates (quote, fetched_at desc);
create index on public.audit_logs (company_id, created_at desc);

-- Prevent paying the same employee twice in one period (mirrors the contract rule).
-- Enforced by the trigger below, because an index cannot read another table.
create or replace function public.enforce_one_payment_per_period() returns trigger
language plpgsql as $$
declare
  p integer;
  c uuid;
begin
  select period, company_id into p, c from public.payrolls where id = new.payroll_id;
  if exists (
    select 1
    from public.payroll_items i
    join public.payrolls r on r.id = i.payroll_id
    where i.employee_id = new.employee_id
      and r.company_id = c
      and r.period = p
      and r.status in ('queued', 'executed')
      and i.payroll_id <> new.payroll_id
  ) then
    raise exception 'Employee already queued or paid for period %', p;
  end if;
  return new;
end $$;

create trigger payroll_items_one_per_period_trg
  before insert on public.payroll_items
  for each row execute function public.enforce_one_payment_per_period();
