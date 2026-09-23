-- ROLLBACK for supabase/migrations/20260924010000_registration_payment_deadline.sql
-- Not a migration (kept outside supabase/migrations so it never runs automatically).
-- Run manually in the SQL Editor only if the change must be undone.
-- Order:
--   1. Redeploy the previous Edge Functions (public-events, create-payment,
--      payment-status) so nothing reads payment_deadline any more.
--   2. Run this file.
--   3. If the migration should be re-applied later, also run:
--      delete from supabase_migrations.schema_migrations where version = '20260924010000';
-- The function bodies below are copied verbatim from 20260923010000 and 20260915020000.
-- The final DROP COLUMN discards the stored deadlines (destructive; run deliberately).

begin;

create or replace function public.create_registration(
  p_event_slug text, p_name text, p_phone text, p_email text,
  p_reason text, p_notes text, p_consent boolean,
  p_domicile text default null, p_institution text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
  v_reserved integer;
  v_code text;
  v_registration_status text;
  v_payment_status text;
  v_attempt integer := 0;
  v_constraint_name text;
begin
  if p_consent is distinct from true then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
  end if;

  select event.* into v_event
    from public.events as event
   where event.slug = btrim(p_event_slug)
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;
  if v_event.status <> 'open' then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_OPEN';
  end if;
  if v_event.registration_deadline is not null
     and v_event.registration_deadline < pg_catalog.now() then
    raise exception using errcode = 'P0001', message = 'REGISTRATION_CLOSED';
  end if;

  if v_event.capacity is not null then
    select count(*)::integer into v_reserved
      from public.registrations as registration
     where registration.event_id = v_event.id
       and registration.registration_status in ('pending_payment', 'confirmed');
    if v_reserved >= v_event.capacity then
      raise exception using errcode = 'P0001', message = 'EVENT_FULL';
    end if;
  end if;

  if v_event.price = 0 then
    v_registration_status := 'confirmed';
    v_payment_status := 'not_required';
  else
    v_registration_status := 'pending_payment';
    v_payment_status := 'unpaid';
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_code := 'KB-'
      || pg_catalog.to_char(pg_catalog.clock_timestamp() at time zone 'Asia/Jakarta', 'YYYYMMDD')
      || '-'
      || pg_catalog.substr(
        pg_catalog.upper(pg_catalog.replace(gen_random_uuid()::text, '-', '')),
        1,
        6
      );
    begin
      insert into public.registrations (
        registration_code, event_id, name, phone, email, domicile, institution,
        reason, notes, consent, registration_status, payment_status, amount
      ) values (
        v_code, v_event.id, btrim(p_name), btrim(p_phone), pg_catalog.lower(btrim(p_email)),
        nullif(btrim(p_domicile), ''), nullif(btrim(p_institution), ''),
        nullif(btrim(p_reason), ''), nullif(btrim(p_notes), ''), true,
        v_registration_status, v_payment_status, v_event.price
      );
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name is distinct from 'registrations_code_key' then
        raise;
      end if;
      if v_attempt >= 5 then raise; end if;
    end;
  end loop;

  return pg_catalog.jsonb_build_object(
    'success', true,
    'registration', pg_catalog.jsonb_build_object(
      'registration_code', v_code,
      'event_slug', v_event.slug,
      'event_title', v_event.title,
      'amount', v_event.price,
      'registration_status', v_registration_status,
      'payment_status', v_payment_status
    )
  );
end;
$$;

create or replace function public.prepare_payment_attempt(
  p_registration_code text,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_registration public.registrations%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_event_title text;
  v_event_status text;
  v_order_id text;
  v_collision_attempt integer := 0;
  v_constraint_name text;
begin
  select registration.*
    into v_registration
    from public.registrations as registration
   where registration.registration_code = pg_catalog.upper(btrim(p_registration_code))
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'REGISTRATION_NOT_FOUND';
  end if;

  select event.title, event.status
    into v_event_title, v_event_status
    from public.events as event
   where event.id = v_registration.event_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'PAYMENT_NOT_ELIGIBLE';
  end if;
  if pg_catalog.lower(btrim(p_email)) is distinct from pg_catalog.lower(v_registration.email) then
    raise exception using errcode = 'P0001', message = 'REGISTRATION_MISMATCH';
  end if;
  if v_registration.amount <= 0 or v_registration.payment_status = 'not_required' then
    raise exception using errcode = 'P0001', message = 'PAYMENT_NOT_REQUIRED';
  end if;
  if v_registration.payment_status = 'paid' or v_registration.registration_status = 'confirmed' then
    raise exception using errcode = 'P0001', message = 'PAYMENT_ALREADY_PAID';
  end if;
  if v_registration.registration_status <> 'pending_payment'
     or v_registration.payment_status not in ('unpaid', 'pending', 'failed', 'expired') then
    raise exception using errcode = 'P0001', message = 'PAYMENT_NOT_ELIGIBLE';
  end if;
  if v_event_status in ('cancelled', 'completed') then
    raise exception using errcode = 'P0001', message = 'PAYMENT_NOT_ELIGIBLE';
  end if;

  select attempt.* into v_attempt
    from public.payment_attempts as attempt
   where attempt.registration_id = v_registration.id
     and attempt.status = 'pending'
     and attempt.expires_at > pg_catalog.now()
     and attempt.qr_url is not null
   order by attempt.created_at desc
   limit 1;

  if found then
    return pg_catalog.jsonb_build_object(
      'is_reused', true,
      'attempt_id', v_attempt.id,
      'order_id', v_attempt.order_id,
      'amount', v_attempt.amount,
      'created_at', v_attempt.created_at,
      'registration_code', v_registration.registration_code,
      'event_title', v_event_title,
      'qr_url', v_attempt.qr_url,
      'expires_at', v_attempt.expires_at
    );
  end if;

  select attempt.* into v_attempt
    from public.payment_attempts as attempt
   where attempt.registration_id = v_registration.id
     and attempt.status = 'pending'
     and (attempt.expires_at is null or attempt.expires_at <= pg_catalog.now())
   order by attempt.created_at desc
   limit 1;

  if found then
    return pg_catalog.jsonb_build_object(
      'needs_recovery', true,
      'attempt_id', v_attempt.id,
      'order_id', v_attempt.order_id,
      'amount', v_attempt.amount,
      'created_at', v_attempt.created_at,
      'registration_code', v_registration.registration_code,
      'event_title', v_event_title,
      'local_status', v_attempt.status,
      'qr_url', v_attempt.qr_url,
      'expires_at', v_attempt.expires_at
    );
  end if;

  if exists (
    select 1 from public.payment_attempts as attempt
     where attempt.registration_id = v_registration.id
       and attempt.status = 'creating'
       and attempt.created_at > pg_catalog.now() - interval '2 minutes'
  ) then
    raise exception using errcode = 'P0001', message = 'PAYMENT_IN_PROGRESS';
  end if;

  select attempt.* into v_attempt
    from public.payment_attempts as attempt
   where attempt.registration_id = v_registration.id
     and attempt.status = 'creating'
   order by attempt.created_at desc
   limit 1;

  if found then
    return pg_catalog.jsonb_build_object(
      'needs_recovery', true,
      'attempt_id', v_attempt.id,
      'order_id', v_attempt.order_id,
      'amount', v_attempt.amount,
      'created_at', v_attempt.created_at,
      'registration_code', v_registration.registration_code,
      'event_title', v_event_title,
      'local_status', v_attempt.status,
      'expires_at', v_attempt.expires_at
    );
  end if;

  loop
    v_collision_attempt := v_collision_attempt + 1;
    v_order_id := 'KBPAY-' || v_registration.registration_code || '-'
      || pg_catalog.substr(
        pg_catalog.upper(pg_catalog.replace(gen_random_uuid()::text, '-', '')),
        1,
        8
      );
    begin
      insert into public.payment_attempts (registration_id, order_id, amount, status)
      values (v_registration.id, v_order_id, v_registration.amount, 'creating')
      returning * into v_attempt;
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name is distinct from 'payment_attempts_order_id_key' then raise; end if;
      if v_collision_attempt >= 5 then raise; end if;
    end;
  end loop;

  return pg_catalog.jsonb_build_object(
    'is_reused', false,
    'attempt_id', v_attempt.id,
    'order_id', v_attempt.order_id,
    'amount', v_attempt.amount,
    'created_at', v_attempt.created_at,
    'registration_code', v_registration.registration_code,
    'event_title', v_event_title
  );
end;
$$;

comment on function public.prepare_payment_attempt(text, text) is 'Locks a paid registration and atomically reuses or creates a payment attempt.';

alter table public.registrations drop column if exists payment_deadline;

commit;
