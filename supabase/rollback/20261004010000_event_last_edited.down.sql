-- Rollback for 20261004010000_event_last_edited.sql.
-- Deploy the previous admin-events function first; the new one selects these columns.
alter table public.events
  drop column if exists last_edited_by,
  drop column if exists last_edited_at;
