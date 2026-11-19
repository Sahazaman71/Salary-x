-- Row Level Security for SalaryX. Apply after 0001_schema.sql.
-- Roles: company_admin, payroll_manager, employee, platform_admin.
-- The service-role key is NEVER used in the browser. Server-side jobs (keeper, rate refresh) use it only on the server.

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.employees enable row level security;
alter table public.payrolls enable row level security;
alter table public.payroll_items enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.payroll_schedules enable row level security;
alter table public.exchange_rates enable row level security;
alter table public.audit_logs enable row level security;

-- Helpers. SECURITY DEFINER so they can read profiles without recursing into its own policies.
create or replace function public.current_role_name() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'platform_admin' from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_company_staff(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.company_members m
    where m.company_id = cid and m.profile_id = auth.uid() and m.role in ('company_admin', 'payroll_manager')
  )
$$;

create or replace function public.is_company_admin(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.company_members m
    where m.company_id = cid and m.profile_id = auth.uid() and m.role = 'company_admin'
  )
$$;

create or replace function public.my_employee_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from public.employees where profile_id = auth.uid()
$$;

-- profiles: you see yourself and the people in your company. You can edit your own name only.
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_platform_admin() or (company_id is not null and public.is_company_staff(company_id)));
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));

-- companies
create policy companies_select on public.companies for select
  using (public.is_platform_admin() or public.is_company_staff(id)
         or id in (select company_id from public.employees where profile_id = auth.uid()));
-- No insert policy: companies are created by the sign-up trigger (0003_auth.sql), never by the browser.
create policy companies_update on public.companies for update using (public.is_company_admin(id)) with check (public.is_company_admin(id));

-- company_members: staff read, admin manages
create policy members_select on public.company_members for select
  using (public.is_platform_admin() or public.is_company_staff(company_id) or profile_id = auth.uid());
create policy members_write on public.company_members for all
  using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

-- employees: staff manage, an employee reads their own record
create policy employees_select on public.employees for select
  using (public.is_platform_admin() or public.is_company_staff(company_id) or profile_id = auth.uid());
create policy employees_write on public.employees for all
  using (public.is_company_staff(company_id)) with check (public.is_company_staff(company_id));
-- Employees cannot update their own row. They submit a wallet through public.submit_my_wallet() (0003_auth.sql).

-- Helpers for payroll policies. SECURITY DEFINER avoids recursive policy evaluation between payrolls and items.
create or replace function public.payroll_company_id(pid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from public.payrolls where id = pid
$$;

create or replace function public.payroll_is_executed(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select status = 'executed' from public.payrolls where id = pid), false)
$$;

create or replace function public.employee_in_payroll(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.payroll_items i
    where i.payroll_id = pid and i.employee_id in (select id from public.employees where profile_id = auth.uid())
  )
$$;

-- payrolls and items: staff manage. Employees read only paid payrolls that include them.
create policy payrolls_select on public.payrolls for select
  using (public.is_platform_admin() or public.is_company_staff(company_id)
         or (status = 'executed' and public.employee_in_payroll(id)));
create policy payrolls_write on public.payrolls for all
  using (public.is_company_staff(company_id)) with check (public.is_company_staff(company_id));

create policy items_select on public.payroll_items for select
  using (
    public.is_platform_admin()
    or public.is_company_staff(public.payroll_company_id(payroll_id))
    or (employee_id in (select public.my_employee_ids()) and public.payroll_is_executed(payroll_id))
  );
create policy items_write on public.payroll_items for all
  using (public.is_company_staff(public.payroll_company_id(payroll_id)))
  with check (public.is_company_staff(public.payroll_company_id(payroll_id)));

-- transactions: staff read and insert. Employees see the execution transaction of payrolls that paid them.
create policy tx_select on public.payment_transactions for select
  using (
    public.is_platform_admin() or public.is_company_staff(company_id)
    or (kind = 'batch_execute' and payroll_id is not null and public.employee_in_payroll(payroll_id))
  );
create policy tx_insert on public.payment_transactions for insert with check (public.is_company_staff(company_id));
create policy tx_update on public.payment_transactions for update
  using (public.is_company_staff(company_id)) with check (public.is_company_staff(company_id));
-- No delete policy: transaction records are append-only for users.

-- schedules
create policy schedules_select on public.payroll_schedules for select using (public.is_platform_admin() or public.is_company_staff(company_id));
create policy schedules_write on public.payroll_schedules for all
  using (public.is_company_staff(company_id)) with check (public.is_company_staff(company_id));

-- exchange rates: readable by any signed-in user. Written only by a server job with the service role.
create policy rates_select on public.exchange_rates for select using (auth.uid() is not null);

-- audit logs: staff read their company, append-only inserts
create policy audit_select on public.audit_logs for select using (public.is_platform_admin() or (company_id is not null and public.is_company_staff(company_id)));
create policy audit_insert on public.audit_logs for insert with check (actor_id = auth.uid());
