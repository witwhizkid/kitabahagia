-- Raw QRIS payload returned by Midtrans for a payment attempt, so the site can
-- render its own QR code instead of the Midtrans poster image.
-- Nullable: older attempts keep only qr_url and the site falls back to that image.
-- Written and read only by the create-payment Edge Function (service_role);
-- RLS on payment_attempts stays unchanged.
-- Rollback: supabase/rollback/20260926010000_payment_attempt_qr_string.down.sql
alter table public.payment_attempts
  add column if not exists qr_string text;

alter table public.payment_attempts
  drop constraint if exists payment_attempts_qr_string_check;
alter table public.payment_attempts
  add constraint payment_attempts_qr_string_check
  check (qr_string is null or (char_length(qr_string) between 20 and 1024 and qr_string like '000201%'));

comment on column public.payment_attempts.qr_string is
  'Raw QRIS payload from Midtrans (EMV string starting with 000201). Null for attempts created before 20260926.';
