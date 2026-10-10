-- Manual QRIS payment (Oct 2026): fallback while no payment gateway is approved.
-- create-payment (PAYMENT_PROVIDER=manual) embeds the event price (set by the admin) in the
-- owner's static QRIS; the registrant pays and uploads a proof (private bucket
-- payment-proofs), which confirms the registration right away (owner decision "C", Oct 2026).
-- An admin then matches it against the GoPay Merchant mutations and marks it valid, or
-- cancels it (seat released).
-- payment_attempts is not used for manual payments.
-- Rollback: supabase/rollback/20261018010000_manual_qris_payment.down.sql

alter table public.registrations
  add column if not exists manual_amount integer,
  add column if not exists payment_proof_path text,
  add column if not exists payment_proof_submitted_at timestamptz,
  add column if not exists payment_reviewed_at timestamptz,
  add column if not exists payment_reviewed_by uuid;

alter table public.registrations
  drop constraint if exists registrations_manual_amount_positive;
alter table public.registrations
  add constraint registrations_manual_amount_positive check (manual_amount is null or manual_amount > 0);

comment on column public.registrations.manual_amount is
  'Manual QRIS: amount embedded in the QR (the event price at the time).';
comment on column public.registrations.payment_proof_path is
  'Manual QRIS: object path in the private payment-proofs bucket.';
comment on column public.registrations.payment_reviewed_at is
  'Manual QRIS: when an admin checked the proof (null = confirmed but not checked yet).';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 2097152,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
-- No storage.objects policies: browsers cannot read or upload; Edge Functions use service_role.

create or replace function public.prepare_manual_payment(p_registration_code text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_registration public.registrations%rowtype;
  v_title text;
  v_amount integer;
begin
  select registration.* into v_registration
    from public.registrations as registration
   where registration.registration_code = pg_catalog.upper(btrim(p_registration_code))
   for update;
  if not found
     or pg_catalog.lower(btrim(p_email)) is distinct from pg_catalog.lower(v_registration.email) then
    raise exception using errcode = 'P0001', message = 'REGISTRATION_NOT_FOUND';
  end if;
  if v_registration.payment_status = 'paid' then
    raise exception using errcode = 'P0001', message = 'PAYMENT_ALREADY_PAID';
  end if;
  if v_registration.amount <= 0 then
    raise exception using errcode = 'P0001', message = 'PAYMENT_NOT_REQUIRED';
  end if;
  if v_registration.registration_status <> 'pending_payment' then
    raise exception using errcode = 'P0001', message = 'PAYMENT_NOT_ELIGIBLE';
  end if;
  if v_registration.payment_deadline is not null
     and v_registration.payment_deadline <= pg_catalog.now() then
    raise exception using errcode = 'P0001', message = 'PAYMENT_DEADLINE_PASSED';
  end if;

  v_amount := v_registration.amount;
  if v_registration.manual_amount is distinct from v_amount then
    update public.registrations set manual_amount = v_amount where id = v_registration.id;
  end if;

  select event.title into v_title from public.events as event where event.id = v_registration.event_id;
  return pg_catalog.jsonb_build_object(
    'registration_code', v_registration.registration_code,
    'event_title', v_title,
    'amount', v_amount,
    'payment_deadline', v_registration.payment_deadline,
    'proof_submitted_at', v_registration.payment_proof_submitted_at
  );
end;
$$;

-- Records an uploaded proof and confirms the registration (the seat was still held, so no
-- capacity check is needed); the admin checks it afterwards in review_manual_payment.
create or replace function public.submit_payment_proof(p_registration_code text, p_email text, p_path text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_registration public.registrations%rowtype;
begin
  if p_path is null or p_path !~ '^KB-[A-Z0-9-]{6,40}/[0-9a-f-]{36}\.(jpg|png|webp)$' then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
  end if;
  select registration.* into v_registration
    from public.registrations as registration
   where registration.registration_code = pg_catalog.upper(btrim(p_registration_code))
   for update;
  if not found
     or pg_catalog.lower(btrim(p_email)) is distinct from pg_catalog.lower(v_registration.email) then
    raise exception using errcode = 'P0001', message = 'REGISTRATION_NOT_FOUND';
  end if;
  if v_registration.payment_status = 'paid' then
    raise exception using errcode = 'P0001', message = 'PAYMENT_ALREADY_PAID';
  end if;
  if v_registration.registration_status <> 'pending_payment' or v_registration.manual_amount is null then
    raise exception using errcode = 'P0001', message = 'PAYMENT_NOT_ELIGIBLE';
  end if;
  if v_registration.payment_deadline is not null
     and v_registration.payment_deadline <= pg_catalog.now() then
    raise exception using errcode = 'P0001', message = 'PAYMENT_DEADLINE_PASSED';
  end if;

  update public.registrations
     set payment_proof_path = p_path,
         payment_proof_submitted_at = pg_catalog.now(),
         registration_status = 'confirmed',
         payment_status = 'paid',
         payment_reference = 'MANUAL-' || v_registration.registration_code
   where id = v_registration.id;
  return pg_catalog.jsonb_build_object('registration_code', v_registration.registration_code);
end;
$$;

-- Admin check of an unchecked manual payment: 'valid' records the check; 'cancelled'
-- cancels the registration (seat released) when the proof does not match a real payment.
create or replace function public.review_manual_payment(p_registration_code text, p_decision text, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_registration public.registrations%rowtype;
begin
  if p_decision not in ('valid', 'cancelled') then
    raise exception using errcode = 'P0001', message = 'INVALID_DECISION';
  end if;
  select registration.* into v_registration
    from public.registrations as registration
   where registration.registration_code = p_registration_code
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'REGISTRATION_NOT_FOUND';
  end if;
  if v_registration.payment_reviewed_at is not null then
    raise exception using errcode = 'P0001', message = 'PAYMENT_ALREADY_REVIEWED';
  end if;
  if v_registration.registration_status <> 'confirmed' or v_registration.payment_proof_path is null then
    raise exception using errcode = 'P0001', message = 'PAYMENT_NOT_ELIGIBLE';
  end if;

  if p_decision = 'valid' then
    update public.registrations
       set payment_reviewed_at = pg_catalog.now(), payment_reviewed_by = p_actor
     where id = v_registration.id;
  else
    update public.registrations
       set registration_status = 'cancelled', payment_status = 'failed',
           payment_reviewed_at = pg_catalog.now(), payment_reviewed_by = p_actor
     where id = v_registration.id;
  end if;
  return pg_catalog.jsonb_build_object('registration_code', v_registration.registration_code, 'decision', p_decision);
end;
$$;

revoke all on function public.prepare_manual_payment(text, text) from public, anon, authenticated;
revoke all on function public.submit_payment_proof(text, text, text) from public, anon, authenticated;
revoke all on function public.review_manual_payment(text, text, uuid) from public, anon, authenticated;
grant execute on function public.prepare_manual_payment(text, text) to service_role;
grant execute on function public.submit_payment_proof(text, text, text) to service_role;
grant execute on function public.review_manual_payment(text, text, uuid) to service_role;
