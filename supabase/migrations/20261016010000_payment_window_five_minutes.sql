-- Allow a 5-minute payment window (owner request, Oct 2026: 10 minutes felt too long).
-- events.payment_window_minutes was limited to 10..1440; it is now 5..1440.
-- Nothing else changes: create_registration still computes
-- payment_deadline = least(now() + payment_window_minutes, registration_deadline),
-- and create-payment sizes the QRIS expiry from that deadline.
-- Rollback: supabase/rollback/20261016010000_payment_window_five_minutes.down.sql

alter table public.events
  drop constraint if exists events_payment_window_minutes_range;

alter table public.events
  add constraint events_payment_window_minutes_range
  check (payment_window_minutes between 5 and 1440);
