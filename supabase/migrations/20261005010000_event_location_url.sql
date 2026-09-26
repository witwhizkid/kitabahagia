-- Optional Google Maps link for an event's location (meeting point). Shown on the
-- registration page as "Petunjuk arah". admin-events only accepts Google Maps
-- https links; the check below is a last guard against non-https values.
-- Deploy order: this migration first, then admin-events and public-events (they select it).
-- Rollback: supabase/rollback/20261005010000_event_location_url.down.sql

alter table public.events
  add column if not exists location_url text;

alter table public.events
  drop constraint if exists events_location_url_https,
  add constraint events_location_url_https check (location_url is null or location_url ~ '^https://');
