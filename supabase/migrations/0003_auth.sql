-- Real accounts. Apply after 0001_schema.sql and 0002_rls.sql.
--
-- Roles are assigned HERE, on the server, when an account is created. The browser can never choose its own role:
--   * kind = 'company'  -> creates the caller's own company and makes them its admin
--   * otherwise         -> the email must already be invited (company_members) or listed as an employee
--   * platform_admin    -> never through sign-up. Set it by hand (see the bottom of this file)
-- If no invitation exists the sign-up fails, so strangers cannot create accounts inside a company.

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  kind text := coalesce(meta ->> 'kind', 'invited');
  mail text := lower(new.email);
  fname text := coalesce(nullif(trim(meta ->> 'full_name'), ''), split_part(new.email, '@', 1));
  cur text := coalesce(nullif(meta ->> 'currency', ''), 'USD');
  cid uuid;
  inv record;
  emp record;
begin
  if kind = 'company' then
    if cur <> all (enum_range(null::public.currency_code)::text[]) then cur := 'USD'; end if;
    insert into public.profiles (id, email, full_name, role) values (new.id, mail, fname, 'company_admin');
    insert into public.companies (name, country, default_currency, owner_id, onchain_id)
    values (
      coalesce(nullif(trim(meta ->> 'company_name'), ''), fname || '''s company'),
      coalesce(nullif(meta ->> 'country', ''), 'United States'),
      cur::public.currency_code,
      new.id,
      '0x' || encode(sha256(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid())), 'hex')
    ) returning id into cid;
    update public.profiles set company_id = cid where id = new.id;
    insert into public.company_members (company_id, profile_id, email, role) values (cid, new.id, mail, 'company_admin');
    return new;
  end if;

  select * into inv from public.company_members where lower(email) = mail and profile_id is null order by created_at limit 1;
  if found then
    insert into public.profiles (id, email, full_name, role, company_id) values (new.id, mail, fname, inv.role, inv.company_id);
    update public.company_members set profile_id = new.id where id = inv.id;
    return new;
  end if;

  select * into emp from public.employees where lower(email) = mail and profile_id is null order by created_at limit 1;
  if found then
    insert into public.profiles (id, email, full_name, role, company_id) values (new.id, mail, fname, 'employee', emp.company_id);
    update public.employees
       set profile_id = new.id, status = case when status = 'invited' then 'active'::public.employee_status else status end
     where id = emp.id;
    return new;
  end if;

  raise exception 'No invitation found for this email';
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Employees submit a payout wallet through this function. It can change nothing else on their record,
-- and the wallet goes back to 'pending' until a manager or admin approves it.
create or replace function public.submit_my_wallet(addr text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if addr is null or addr !~ '^0x[0-9a-fA-F]{40}$' then
    raise exception 'Invalid wallet address';
  end if;
  update public.employees set wallet = addr, wallet_status = 'pending' where profile_id = auth.uid();
  if not found then
    raise exception 'No employee record for this account';
  end if;
end $$;

revoke all on function public.submit_my_wallet(text) from public;
grant execute on function public.submit_my_wallet(text) to authenticated;

-- Column-level locks so nobody can rewrite ownership links through the API, even where a row policy allows an update.
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

revoke update on public.employees from authenticated;
grant update (name, email, country, wallet, wallet_status, salary_amount, currency, status) on public.employees to authenticated;

revoke update on public.company_members from authenticated;
grant update (role, wallet) on public.company_members to authenticated;

revoke update on public.companies from authenticated;
grant update (name, country, default_currency) on public.companies to authenticated;

-- Audit logs are append-only for users. Transaction records can only be deleted while still unsent (a rejected wallet prompt).
revoke update, delete on public.audit_logs from authenticated;
create policy tx_delete_unsent on public.payment_transactions for delete
  using (public.is_company_staff(company_id) and status = 'pending' and hash is null);

-- ---------------------------------------------------------------------------------------------------------
-- Platform admin: promote an existing account by hand, in the SQL editor, never from the app:
--   update public.profiles set role = 'platform_admin', company_id = null where email = 'you@example.com';
-- ---------------------------------------------------------------------------------------------------------
