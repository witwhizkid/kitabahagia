-- Manual QRIS late proof (Oct 2026, opening night: a volunteer paid but the 30-minute hold lapsed
-- before the proof was uploaded, and had to register again). submit_payment_proof now also accepts a
-- proof after payment_deadline, as long as a seat is still free and the same person has no other
-- active registration for the event (otherwise they would hold two seats). Before the deadline nothing
-- changes: the seat is still held, so no capacity check.
-- Rollback: supabase/rollback/20261019010000_manual_late_proof.down.sql

create or replace function public.submit_payment_proof(p_registration_code text, p_email text, p_path text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_registration public.registrations%rowtype;
  v_event public.events%rowtype;
  v_reserved integer;
begin
  if p_path is null or p_path !~ '^KB-[A-Z0-9-]{6,40}/[0-9a-f-]{36}\.(jpg|png|webp)$' then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
  end if;
  select registration.* into v_registration
    from public.registrations as registration
   where registration.registration_code = pg_catalog.upper(btrim(p_registration_code));
  if not found
     or pg_catalog.lower(btrim(p_email)) is distinct from pg_catalog.lower(v_registration.email) then
    raise exception using errcode = 'P0001', message = 'REGISTRATION_NOT_FOUND';
  end if;

  -- Same lock order as create_registration (event row first), so a late proof and a new
  -- registration for the last seat are counted one at a time.
  select event.* into v_event from public.events as event where event.id = v_registration.event_id for update;
  select registration.* into v_registration
    from public.registrations as registration where registration.id = v_registration.id for update;

  if v_registration.payment_status = 'paid' then
    raise exception using errcode = 'P0001', message = 'PAYMENT_ALREADY_PAID';
  end if;
  if v_registration.registration_status <> 'pending_payment' or v_registration.manual_amount is null then
    raise exception using errcode = 'P0001', message = 'PAYMENT_NOT_ELIGIBLE';
  end if;

  if v_registration.payment_deadline is not null
     and v_registration.payment_deadline <= pg_catalog.now() then
    if v_event.status = 'cancelled' then
      raise exception using errcode = 'P0001', message = 'PAYMENT_DEADLINE_PASSED';
    end if;
    -- Already registered again (or still holding another seat) under the same email or phone.
    if exists (
      select 1 from public.registrations as other
       where other.event_id = v_event.id
         and other.id <> v_registration.id
         and (pg_catalog.lower(other.email) = pg_catalog.lower(v_registration.email)
              or public.normalize_phone(other.phone) = public.normalize_phone(v_registration.phone))
         and (other.registration_status = 'confirmed'
              or (other.registration_status = 'pending_payment'
                  and (other.payment_deadline is null or other.payment_deadline > pg_catalog.now())))
    ) then
      raise exception using errcode = 'P0001', message = 'ALREADY_REGISTERED';
    end if;
    if v_event.capacity is not null then
      select count(*)::integer into v_reserved
        from public.registrations as registration
       where registration.event_id = v_event.id
         and (registration.registration_status = 'confirmed'
              or (registration.registration_status = 'pending_payment'
                  and (registration.payment_deadline is null
                       or registration.payment_deadline > pg_catalog.now())));
      if v_reserved >= v_event.capacity then
        raise exception using errcode = 'P0001', message = 'EVENT_FULL';
      end if;
    end if;
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

revoke all on function public.submit_payment_proof(text, text, text) from public, anon, authenticated;
grant execute on function public.submit_payment_proof(text, text, text) to service_role;
