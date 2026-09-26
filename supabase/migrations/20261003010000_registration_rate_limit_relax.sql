-- Relax the registration rate limit from 5/10 min + 20/day to 30/10 min + 200/day per IP.
-- Indonesian mobile carriers (CGNAT) and campus wifi put many real people behind one IP, and a
-- new Instagram poster brings many sign-ups at once; the old limits could block them.
-- Only the thresholds change; the table and the function signature stay the same.
-- Rollback: supabase/rollback/20261003010000_registration_rate_limit_relax.down.sql

-- Returns true and records the attempt when the IP is under both limits;
-- returns false (and records nothing) when it is over either limit.
-- Limits: 30 attempts per 10 minutes, 200 per 24 hours.
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
  if v_recent >= 30 or v_daily >= 200 then
    return false;
  end if;
  insert into public.registration_attempts (ip_hash) values (p_ip_hash);
  return true;
end;
$$;
revoke all on function public.check_registration_rate(text) from public, anon, authenticated;
grant execute on function public.check_registration_rate(text) to service_role;
