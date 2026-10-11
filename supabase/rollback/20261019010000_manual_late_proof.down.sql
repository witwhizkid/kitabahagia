-- Rollback of 20261019010000_manual_late_proof: restore the deadline-strict submit_payment_proof.
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
