-- Confirmation email bookkeeping. Set once when the "you're in" email is claimed,
-- so repeated Midtrans notifications never send a second email.
alter table public.registrations
  add column if not exists confirmation_email_sent_at timestamptz,
  add column if not exists confirmation_email_error text;
