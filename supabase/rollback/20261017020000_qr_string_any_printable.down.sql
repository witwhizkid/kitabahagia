-- Undo 20261017020000_qr_string_any_printable.sql: QRIS (000201...) payloads only.
-- Non-QRIS payloads (iPaymu sandbox) are cleared first so the old check can be added.

update public.payment_attempts
   set qr_string = null
 where qr_string is not null and qr_string not like '000201%';

alter table public.payment_attempts
  drop constraint if exists payment_attempts_qr_string_check;
alter table public.payment_attempts
  add constraint payment_attempts_qr_string_check
  check (qr_string is null or (char_length(qr_string) between 20 and 1024 and qr_string like '000201%'));
