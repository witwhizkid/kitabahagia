-- Rollback for 20261005010000_event_location_url.sql.
-- Deploy the previous admin-events and public-events first; the new ones select this column.
alter table public.events drop constraint if exists events_location_url_https;
alter table public.events drop column if exists location_url;
