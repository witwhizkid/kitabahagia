-- Rollback for 20260926010000_payment_attempt_qr_string.sql.
-- Destructive: drops stored QRIS payloads. The site then shows the Midtrans QR image (qr_url).
alter table public.payment_attempts drop constraint if exists payment_attempts_qr_string_check;
alter table public.payment_attempts drop column if exists qr_string;
