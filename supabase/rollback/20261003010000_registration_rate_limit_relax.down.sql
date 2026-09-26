-- Rollback for 20261003010000_registration_rate_limit_relax.sql:
-- restores the original limits (5 per 10 minutes, 20 per 24 hours).

create or replace function public.check_registration_rate(p_ip_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent integer;
  v_daily integer;
begin
  if p_ip_hash is null or char_length(p_ip_hash) <> 64 then
    return true;
  end if;
  -- One caller per IP at a time so parallel requests cannot all pass.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_ip_hash));
  delete from public.registration_attempts
   where created_at < pg_catalog.now() - interval '1 day';
  select count(*) filter (where created_at > pg_catalog.now() - interval '10 minutes'),
         count(*)
    into v_recent, v_daily
    from public.registration_attempts
   where ip_hash = p_ip_hash;
  if v_recent >= 5 or v_daily >= 20 then
    return false;
  end if;
  insert into public.registration_attempts (ip_hash) values (p_ip_hash);
  return true;
end;
$$;
revoke all on function public.check_registration_rate(text) from public, anon, authenticated;
grant execute on function public.check_registration_rate(text) to service_role;
