-- The iPaymu sandbox returns a placeholder QR payload ("IPAYMU...", not EMV QRIS). Allow any
-- printable payload of 20..1024 characters so a reloaded payment screen still draws the QR.
-- Real QRIS payloads (000201...) from Midtrans and iPaymu production still pass.
-- Rollback: supabase/rollback/20261017020000_qr_string_any_printable.down.sql

alter table public.payment_attempts
  drop constraint if exists payment_attempts_qr_string_check;
alter table public.payment_attempts
  add constraint payment_attempts_qr_string_check
  check (qr_string is null or (char_length(qr_string) between 20 and 1024 and qr_string ~ '^[ -~]+$'));
