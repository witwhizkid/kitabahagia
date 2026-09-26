-- Manual checks for migration 20261003010000_registration_rate_limit_relax.
-- Run in Supabase SQL Editor after the migration. All output rows should pass.
-- Uses synthetic 64-character hashes that no real IP produces, and deletes them at the end.

drop table if exists pg_temp.kb_rate_relax_test;
create temp table kb_rate_relax_test (
  check_name text, expected text, actual text, pass boolean
);

do $$
declare
  v_ten constant text := repeat('a', 63) || '1';   -- 10-minute window
  v_day constant text := repeat('a', 63) || '2';   -- 24-hour window
  v_old constant text := repeat('a', 63) || '3';   -- attempts older than the window
  v_ok boolean;
  v_passed integer := 0;
  i integer;
begin
  delete from public.registration_attempts where ip_hash in (v_ten, v_day, v_old);

  -- 30 attempts in 10 minutes pass, the 31st is refused.
  for i in 1..30 loop
    if public.check_registration_rate(v_ten) then v_passed := v_passed + 1; end if;
  end loop;
  insert into kb_rate_relax_test values ('30 attempts in 10 minutes pass', '30', v_passed::text, v_passed = 30);
  v_ok := public.check_registration_rate(v_ten);
  insert into kb_rate_relax_test values ('31st attempt in 10 minutes is refused', 'false', v_ok::text, v_ok = false);
  insert into kb_rate_relax_test
  select 'refused attempt is not recorded', '30', count(*)::text, count(*) = 30
    from public.registration_attempts where ip_hash = v_ten;

  -- 199 attempts spread over the day (outside the 10-minute window): the 200th passes, the 201st is refused.
  insert into public.registration_attempts (ip_hash, created_at)
  select v_day, now() - interval '1 hour' - (g * interval '1 minute') from generate_series(1, 199) g;
  v_ok := public.check_registration_rate(v_day);
  insert into kb_rate_relax_test values ('200th attempt in 24 hours passes', 'true', v_ok::text, v_ok);
  v_ok := public.check_registration_rate(v_day);
  insert into kb_rate_relax_test values ('201st attempt in 24 hours is refused', 'false', v_ok::text, v_ok = false);

  -- Attempts older than 10 minutes do not count toward the 10-minute limit.
  insert into public.registration_attempts (ip_hash, created_at)
  select v_old, now() - interval '11 minutes' from generate_series(1, 40);
  v_ok := public.check_registration_rate(v_old);
  insert into kb_rate_relax_test values ('attempts older than 10 minutes do not block', 'true', v_ok::text, v_ok);

  -- Malformed hash fails open.
  v_ok := public.check_registration_rate('short');
  insert into kb_rate_relax_test values ('malformed hash is allowed (fail open)', 'true', v_ok::text, v_ok);

  delete from public.registration_attempts where ip_hash in (v_ten, v_day, v_old);
end;
$$;

select * from kb_rate_relax_test;
