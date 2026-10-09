-- Undo 20261018010000_manual_qris_payment.sql. Uploaded proofs stay in the
-- payment-proofs bucket (delete them from the dashboard first if they are no longer needed).

drop function if exists public.review_manual_payment(text, text, uuid);
drop function if exists public.submit_payment_proof(text, text, text);
drop function if exists public.prepare_manual_payment(text, text);

alter table public.registrations
  drop constraint if exists registrations_manual_amount_positive;
alter table public.registrations
  drop column if exists payment_reviewed_by,
  drop column if exists payment_reviewed_at,
  drop column if exists payment_proof_submitted_at,
  drop column if exists payment_proof_path,
  drop column if exists manual_amount;
