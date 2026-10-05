-- Undo 20261016010000_payment_window_five_minutes.sql: back to 10..1440.
-- Events that use the 5-minute window are moved to 10 minutes first, otherwise
-- the old constraint could not be added. Stored payment_deadline values of
-- existing registrations are not touched.
-- Deploy the previous admin-events function together with this rollback.

update public.events
   set payment_window_minutes = 10
 where payment_window_minutes < 10;

alter table public.events
  drop constraint if exists events_payment_window_minutes_range;

alter table public.events
  add constraint events_payment_window_minutes_range
  check (payment_window_minutes between 10 and 1440);
