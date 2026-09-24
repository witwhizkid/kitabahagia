-- Selection decisions (Tahap 2) on top of 20260927010000_event_selection_mode.
--
-- registrations:
--   registration_status gains 'waitlisted' (cadangan) and 'rejected' (tidak lolos);
--   an accepted applicant becomes 'confirmed', like any confirmed registration.
--   selection_decided_at / selection_decided_by record the last decision.
-- events:
--   wa_message_accepted / _waitlisted / _rejected: optional WhatsApp message
--   templates per event; the admin page falls back to its own defaults when null.
-- Functions (service_role only, called by the admin-registrations Edge Function):
--   decide_selection(codes[], decision, actor)  accept / waitlist / reject / reset
--     to 'applied'; never accepts more than events.capacity.
--   selection_overview(event_slug)              counts per status and, per
--     applicant, how many earlier events they joined (confirmed, by email or
--     normalised WhatsApp number).
-- create_registration: waitlisted and rejected applicants also block a second
--   application to the same event (same signature, CREATE OR REPLACE).
--
-- Expand-only. Rollback: supabase/rollback/20260928010000_selection_decisions.down.sql

alter table public.registrations drop constraint if exists registrations_status_allowed;
alter table public.registrations add constraint registrations_status_allowed
  check (registration_status in ('pending_payment', 'confirmed', 'cancelled', 'applied', 'waitlisted', 'rejected'));

alter table public.registrations
  add column if not exists selection_decided_at timestamptz,
  add column if not exists selection_decided_by uuid;

alter table public.events
  add column if not exists wa_message_accepted text,
  add column if not exists wa_message_waitlisted text,
  add column if not exists wa_message_rejected text;

alter table public.events drop constraint if exists events_wa_message_length;
alter table public.events add constraint events_wa_message_length
  check (char_length(coalesce(wa_message_accepted, '')) <= 1000
         and char_length(coalesce(wa_message_waitlisted, '')) <= 1000
         and char_length(coalesce(wa_message_rejected, '')) <= 1000);

create or replace function public.create_registration(
  p_event_slug text, p_name text, p_phone text, p_email text,
  p_reason text, p_notes text, p_consent boolean,
  p_domicile text default null, p_institution text default null,
  p_selection_answer text default null, p_commitment boolean default null
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
  v_selection boolean;
  v_applicants integer;
  v_answer text := nullif(btrim(p_selection_answer), '');
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
  if v_event.registration_opens_at is not null
     and v_event.registration_opens_at > pg_catalog.now() then
    raise exception using errcode = 'P0001', message = 'REGISTRATION_NOT_OPEN';
  end if;

  v_selection := v_event.registration_mode = 'selection';
  if v_selection and v_event.price > 0 then
    -- Selection is for free events; a paid one here is a misconfiguration.
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_OPEN';
  end if;

  if v_selection then
    -- Applications do not take seats; capacity is the number accepted later.
    -- The event row is locked FOR UPDATE, so concurrent applicants are counted one at a time.
    if v_event.applicant_limit is not null then
      select count(*)::integer into v_applicants
        from public.registrations as registration
       where registration.event_id = v_event.id
         and registration.registration_status <> 'cancelled';
      if v_applicants >= v_event.applicant_limit then
        raise exception using errcode = 'P0001', message = 'APPLICANTS_FULL';
      end if;
    end if;
    if v_event.selection_question is not null
       and (v_answer is null
            or char_length(v_answer) < v_event.selection_min_chars
            or char_length(v_answer) > 2000) then
      raise exception using errcode = 'P0001', message = 'INVALID_ANSWER';
    end if;
    if v_event.commitment_text is not null and p_commitment is distinct from true then
      raise exception using errcode = 'P0001', message = 'INVALID_ANSWER';
    end if;
  elsif v_event.capacity is not null then
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
         registration.registration_status in ('confirmed', 'applied', 'waitlisted', 'rejected')
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

  if v_selection then
    v_registration_status := 'applied';
    v_payment_status := 'not_required';
  elsif v_event.price = 0 then
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
        payment_deadline, selection_question, selection_answer, commitment_text
      ) values (
        v_code, v_event.id, btrim(p_name), btrim(p_phone), pg_catalog.lower(btrim(p_email)),
        nullif(btrim(p_domicile), ''), nullif(btrim(p_institution), ''),
        nullif(btrim(p_reason), ''), nullif(btrim(p_notes), ''), true,
        v_registration_status, v_payment_status, v_event.price,
        v_payment_deadline,
        case when v_selection then v_event.selection_question end,
        case when v_selection then v_answer end,
        case when v_selection and p_commitment is true then v_event.commitment_text end
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
      'payment_deadline', v_payment_deadline,
      'announcement_at', case when v_selection then v_event.announcement_at end
    )
  );
end;
$$;


create or replace function public.decide_selection(
  p_registration_codes text[], p_decision text, p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
  v_event_ids uuid[];
  v_new_status text;
  v_found integer;
  v_accepted integer;
  v_codes text[];
begin
  v_new_status := case p_decision
    when 'accepted' then 'confirmed'
    when 'waitlisted' then 'waitlisted'
    when 'rejected' then 'rejected'
    when 'applied' then 'applied'
  end;
  if v_new_status is null then
    raise exception using errcode = 'P0001', message = 'INVALID_DECISION';
  end if;

  select array_agg(distinct pg_catalog.upper(pg_catalog.btrim(code))) into v_codes
    from pg_catalog.unnest(p_registration_codes) as code
   where pg_catalog.btrim(coalesce(code, '')) <> '';
  if v_codes is null or pg_catalog.array_length(v_codes, 1) > 500 then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
  end if;

  select array_agg(distinct registration.event_id) into v_event_ids
    from public.registrations as registration
   where registration.registration_code = any (v_codes);
  if v_event_ids is null or pg_catalog.array_length(v_event_ids, 1) <> 1 then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
  end if;

  -- One event at a time, locked, so two admins cannot both take the last seat.
  select event.* into v_event
    from public.events as event
   where event.id = v_event_ids[1]
   for update;
  if v_event.registration_mode <> 'selection' then
    raise exception using errcode = 'P0001', message = 'NOT_SELECTION_EVENT';
  end if;

  select count(*)::integer into v_found
    from public.registrations as registration
   where registration.registration_code = any (v_codes)
     and registration.registration_status in ('applied', 'confirmed', 'waitlisted', 'rejected');
  if v_found <> pg_catalog.array_length(v_codes, 1) then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
  end if;

  update public.registrations as registration
     set registration_status = v_new_status,
         selection_decided_at = case when v_new_status = 'applied' then null else pg_catalog.now() end,
         selection_decided_by = case when v_new_status = 'applied' then null else p_actor end
   where registration.registration_code = any (v_codes)
     and registration.registration_status is distinct from v_new_status;

  select count(*)::integer into v_accepted
    from public.registrations as registration
   where registration.event_id = v_event.id
     and registration.registration_status = 'confirmed';
  if v_event.capacity is not null and v_accepted > v_event.capacity then
    -- Raising rolls the whole update back.
    raise exception using errcode = 'P0001', message = 'CAPACITY_EXCEEDED';
  end if;

  return public.selection_overview(v_event.slug);
end;
$$;

create or replace function public.selection_overview(p_event_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with event as (
    select id, slug, capacity
      from public.events
     where slug = pg_catalog.btrim(p_event_slug)
  ),
  applicants as (
    select registration.*
      from public.registrations as registration
      join event on event.id = registration.event_id
     where registration.registration_status in ('applied', 'confirmed', 'waitlisted', 'rejected')
  )
  select pg_catalog.jsonb_build_object(
    'capacity', (select capacity from event),
    'counts', pg_catalog.jsonb_build_object(
      'applied', (select count(*) from applicants where registration_status = 'applied'),
      'accepted', (select count(*) from applicants where registration_status = 'confirmed'),
      'waitlisted', (select count(*) from applicants where registration_status = 'waitlisted'),
      'rejected', (select count(*) from applicants where registration_status = 'rejected')
    ),
    -- Earlier participation: confirmed registrations for events that already took place.
    'history', coalesce((
      select pg_catalog.jsonb_object_agg(applicant.registration_code, previous.total)
        from applicants as applicant
        cross join lateral (
          select count(*)::integer as total
            from public.registrations as other
            join public.events as other_event on other_event.id = other.event_id
           where other.event_id <> applicant.event_id
             and other.registration_status = 'confirmed'
             and other_event.event_date < (pg_catalog.now() at time zone 'Asia/Jakarta')::date
             and (pg_catalog.lower(other.email) = pg_catalog.lower(applicant.email)
                  or public.normalize_phone(other.phone) = public.normalize_phone(applicant.phone))
        ) as previous
       where previous.total > 0
    ), '{}'::jsonb)
  )
  from event;
$$;

revoke all on function public.decide_selection(text[], text, uuid) from public, anon, authenticated;
grant execute on function public.decide_selection(text[], text, uuid) to service_role;
revoke all on function public.selection_overview(text) from public, anon, authenticated;
grant execute on function public.selection_overview(text) to service_role;
