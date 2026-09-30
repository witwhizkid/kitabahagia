alter table public.registrations
  drop constraint if exists registrations_age_range,
  drop constraint if exists registrations_referral_source_allowed,
  drop constraint if exists registrations_social_account_length,
  drop column if exists age,
  drop column if exists referral_source,
  drop column if exists social_account;
