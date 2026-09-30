-- Owner request (Oct 2026): age, how the volunteer heard about the event, and a social
-- media account on every registration. create-registration writes them right after the
-- create_registration RPC, so the RPC signature stays unchanged. Nullable: registrations
-- made before this migration have no value.
-- Rollback: supabase/rollback/20261014010000_registration_profile_fields.down.sql

alter table public.registrations
  add column if not exists age smallint,
  add column if not exists referral_source text,
  add column if not exists social_account text;

alter table public.registrations drop constraint if exists registrations_age_range;
alter table public.registrations add constraint registrations_age_range
  check (age is null or age between 10 and 100);

alter table public.registrations drop constraint if exists registrations_referral_source_allowed;
alter table public.registrations add constraint registrations_referral_source_allowed
  check (referral_source is null or referral_source in
    ('instagram', 'tiktok', 'whatsapp', 'teman', 'kampus', 'website', 'lainnya'));

alter table public.registrations drop constraint if exists registrations_social_account_length;
alter table public.registrations add constraint registrations_social_account_length
  check (social_account is null or char_length(social_account) between 2 and 100);
