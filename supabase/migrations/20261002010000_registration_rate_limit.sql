-- Rate limit for anonymous registration requests (create-registration).
-- Stores only an HMAC-SHA-256 (keyed with a server secret) of the client IP and a timestamp; rows older
-- than one day are removed on each call. Service role only.
-- Rollback: supabase/rollback/20261002010000_registration_rate_limit.down.sql

create table if not exists public.registration_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists registration_attempts_ip_time_idx
  on public.registration_attempts (ip_hash, created_at);
alter table public.registration_attempts enable row level security;
revoke all on public.registration_attempts from public, anon, authenticated;

-- Returns true and records the attempt when the IP is under both limits;
-- returns false (and records nothing) when it is over either limit.
-- Limits: 5 attempts per 10 minutes, 20 per 24 hours. A shared network (campus
-- wifi) shares one IP, so keep these generous.
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
