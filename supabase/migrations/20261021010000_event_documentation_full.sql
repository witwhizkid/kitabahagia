-- Event documentation, part 2: the certificate email links the complete photo folder, while the
-- website keeps the curated (public) folder in documentation_url. Never returned by public functions.
-- Rollback: supabase/rollback/20261021010000_event_documentation_full.down.sql
alter table public.events
  add column if not exists documentation_full_url text;

alter table public.events
  drop constraint if exists events_documentation_full_url_https;
alter table public.events
  add constraint events_documentation_full_url_https
  check (documentation_full_url is null or documentation_full_url ~ '^https://');

comment on column public.events.documentation_url is
  'Public (view-only) Google Drive folder with the curated photos shown on the website.';
comment on column public.events.documentation_full_url is
  'Google Drive folder with all event photos; only sent in the certificate email (falls back to documentation_url).';
