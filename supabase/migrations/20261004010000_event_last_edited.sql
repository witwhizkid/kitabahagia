-- "Terakhir diubah oleh siapa, kapan" for events in the admin dashboard.
-- Set only by the admin-events function on create, edit, archive and restore, so
-- automatic changes (e.g. seat counts) do not overwrite who last edited the event.
-- Stores the admin's email as a snapshot so it stays readable if the admin is removed.
-- events is service-role only, so these columns are never exposed to the public.
-- Rollback: supabase/rollback/20261004010000_event_last_edited.down.sql

alter table public.events
  add column if not exists last_edited_by text,
  add column if not exists last_edited_at timestamptz;
