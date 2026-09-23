-- Seat-hold rules on top of 20260924010000_registration_payment_deadline:
--   B. per-event payment window (events.payment_window_minutes, default 15)
--   C. one active registration per person (email or normalised WhatsApp) per event
--
-- Expand-only: new column has a default, new function and indexes are additive,
-- create_registration keeps its signature and grants (CREATE OR REPLACE).
-- Existing registrations and their payment_deadline are not modified.
-- Rollback: supabase/rollback/20260925010000_event_seat_hold_rules.down.sql

alter table public.events
  add column if not exists payment_window_minutes integer not null default 15;

do $guard$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
     where conname = 'events_payment_window_minutes_range'
       and conrelid = 'public.events'::regclass
  ) then
    alter table public.events
      add constraint events_payment_window_minutes_range
      check (payment_window_minutes between 10 and 1440);
  end if;
end
$guard$;

comment on column public.events.payment_window_minutes is
  'Minutes a paid registration holds its seat before payment; capped by registration_deadline.';

-- Comparison key for WhatsApp numbers; the stored phone value is never changed.
-- Digits only, then:
--   international (+... or 00...): kept as country code + number; a trunk 0
--     after +62 is dropped (+62 0812... -> 62812...); other countries such as
--     +81 or +86 are NOT turned into 62...;
--   local: 08... and bare 8... -> 628...; 62... (and 620...) -> 62...
create or replace function public.normalize_phone(p_phone text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when parts.digits = '' then null
    when parts.international then
      case when parts.intl like '620%' then '62' || pg_catalog.substr(parts.intl, 4) else parts.intl end
    when parts.digits like '620%' then '62' || pg_catalog.substr(parts.digits, 4)
    when parts.digits like '62%' then parts.digits
    when parts.digits like '0%' then '62' || pg_catalog.substr(parts.digits, 2)
    when parts.digits like '8%' then '62' || parts.digits
    else parts.digits
  end
  from (
    select source.digits,
           (source.raw like '+%' or source.digits like '00%') as international,
           case when source.digits like '00%' then pg_catalog.substr(source.digits, 3) else source.digits end as intl
      from (select pg_catalog.btrim(coalesce(p_phone, '')) as raw,
                   pg_catalog.regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as digits) as source
  ) as parts;
$$;

-- EXECUTE is limited to service_role. Index expressions are evaluated with the
-- writer's privileges, so any future role that inserts into or updates
-- registrations directly (instead of through the SECURITY DEFINER RPCs) needs
-- EXECUTE on this function too.
revoke all on function public.normalize_phone(text) from public, anon, authenticated;
grant execute on function public.normalize_phone(text) to service_role;

comment on function public.normalize_phone(text) is
  'Normalises an Indonesian WhatsApp number for duplicate checks (628...). Does not modify stored data.';

-- Lookup indexes for the duplicate check. Deliberately NOT unique: older rows may
-- already contain duplicates and a lapsed/cancelled registration must not block.
create index if not exists registrations_event_email_lookup_idx
  on public.registrations (event_id, pg_catalog.lower(email));
create index if not exists registrations_event_phone_lookup_idx
  on public.registrations (event_id, public.normalize_phone(phone));

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
  v_payment_deadline timestamptz;
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
       and (
         registration.registration_status = 'confirmed'
         -- Unpaid registrations stop holding a seat once their payment window ends.
         or (registration.registration_status = 'pending_payment'
             and (registration.payment_deadline is null
                  or registration.payment_deadline > pg_catalog.now()))
       );
    if v_reserved >= v_event.capacity then
      raise exception using errcode = 'P0001', message = 'EVENT_FULL';
    end if;
  end if;

  -- One active registration per person per event (free and paid). The event row
  -- is locked FOR UPDATE above, so concurrent calls for the same event run this
  -- check-then-insert one at a time and each sees the previous caller's commit.
  -- It runs after the capacity check so a full event answers EVENT_FULL to
  -- everyone and does not reveal whether an email or number is registered.
  -- Lapsed (deadline passed) and cancelled registrations do not block, except a
  -- lapsed one whose QRIS was still payable in the last 5 minutes: its
  -- settlement may still arrive (the webhook accepts it), and letting the same
  -- person register and pay again would charge them twice.
  if exists (
    select 1
      from public.registrations as registration
     where registration.event_id = v_event.id
       and (pg_catalog.lower(registration.email) = pg_catalog.lower(btrim(p_email))
            or public.normalize_phone(registration.phone) = public.normalize_phone(p_phone))
       and (
         registration.registration_status = 'confirmed'
         or (registration.registration_status = 'pending_payment'
             and (registration.payment_deadline is null
                  or registration.payment_deadline > pg_catalog.now()
                  or exists (
                    select 1
                      from public.payment_attempts as attempt
                     where attempt.registration_id = registration.id
                       and attempt.status in ('creating', 'pending')
                       and coalesce(attempt.expires_at, attempt.created_at + interval '2 minutes')
                           > pg_catalog.now() - interval '5 minutes'
                  )))
       )
  ) then
    raise exception using errcode = 'P0001', message = 'ALREADY_REGISTERED';
  end if;

  if v_event.price = 0 then
    v_registration_status := 'confirmed';
    v_payment_status := 'not_required';
  else
    v_registration_status := 'pending_payment';
    v_payment_status := 'unpaid';
    v_payment_deadline := pg_catalog.now()
      + pg_catalog.make_interval(mins => v_event.payment_window_minutes);
    if v_event.registration_deadline is not null
       and v_event.registration_deadline < v_payment_deadline then
      v_payment_deadline := v_event.registration_deadline;
    end if;
    -- Too little time left to pay: treat as closed instead of taking a seat that
    -- expires at once. The window itself is at least 10 minutes, so this only
    -- triggers when the event's registration_deadline is less than 5 minutes away.
    if v_payment_deadline < pg_catalog.now() + interval '5 minutes' then
      raise exception using errcode = 'P0001', message = 'REGISTRATION_CLOSED';
    end if;
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
        reason, notes, consent, registration_status, payment_status, amount,
        payment_deadline
      ) values (
        v_code, v_event.id, btrim(p_name), btrim(p_phone), pg_catalog.lower(btrim(p_email)),
        nullif(btrim(p_domicile), ''), nullif(btrim(p_institution), ''),
        nullif(btrim(p_reason), ''), nullif(btrim(p_notes), ''), true,
        v_registration_status, v_payment_status, v_event.price,
        v_payment_deadline
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
      'payment_status', v_payment_status,
      'payment_deadline', v_payment_deadline
    )
  );
end;
$$;
