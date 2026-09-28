-- Rollback for 20261006010000_registration_attendance.sql.
-- Deploy the previous admin-registrations function first; the new one selects
-- attended_at and calls mark_attendance. Dropping the columns deletes the
-- attendance marks, so export them first if they are still needed.
drop function if exists public.mark_attendance(text[], boolean, uuid);
alter table public.registrations
  drop column if exists attended_at,
  drop column if exists attendance_marked_by;
