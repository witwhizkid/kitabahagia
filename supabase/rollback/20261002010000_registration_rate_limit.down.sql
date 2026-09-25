-- Rollback for 20261002010000_registration_rate_limit.sql.
-- create-registration keeps working without it (the check fails open).
drop function if exists public.check_registration_rate(text);
drop table if exists public.registration_attempts;
