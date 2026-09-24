-- Selection-based registration (Tahap 1) on top of 20260925010000_event_seat_hold_rules.
--
-- events:
--   registration_mode      'first_come' (default, current behaviour) or 'selection'
--   registration_opens_at  optional; registration is refused before it (both modes)
--   applicant_limit        selection only: max applicants; the form closes when reached
--   announcement_at        selection only: when results are announced (shown to applicants)
--   selection_question     selection only: essay question asked on the form
--   selection_min_chars    minimum answer length (0 = no minimum)
--   commitment_text        selection only: checkbox text the applicant must tick
-- registrations:
--   registration_status 'applied' = waiting for selection (holds no seat)
--   selection_question / selection_answer / commitment_text: what was asked and
--   answered at the time, so later edits to the event do not rewrite old answers.
--
-- Expand-only: new columns are nullable or have defaults, the status constraint
-- only gains 'applied'. create_registration gains two optional parameters; the
-- old 9-argument version is dropped so PostgREST never sees two overloads, and
-- the currently deployed create-registration Edge Function (which sends only the
-- 9 old arguments) keeps working because the new ones default to null.
-- Rollback: supabase/rollback/20260927010000_event_selection_mode.down.sql

alter table public.events
  add column if not exists registration_mode text not null default 'first_come',
  add column if not exists registration_opens_at timestamptz,
  add column if not exists applicant_limit integer,
  add column if not exists announcement_at timestamptz,
  add column if not exists selection_question text,
  add column if not exists selection_min_chars integer not null default 0,
  add column if not exists commitment_text text;

alter table public.events drop constraint if exists events_registration_mode_allowed;
alter table public.events add constraint events_registration_mode_allowed
  check (registration_mode in ('first_come', 'selection'));
alter table public.events drop constraint if exists events_applicant_limit_positive;
alter table public.events add constraint events_applicant_limit_positive
  check (applicant_limit is null or applicant_limit > 0);
alter table public.events drop constraint if exists events_selection_min_chars_range;
alter table public.events add constraint events_selection_min_chars_range
  check (selection_min_chars between 0 and 2000);
-- Selection is for free events. Fails if an existing row violates it; none can yet
-- because registration_mode is new and defaults to first_come.
alter table public.events drop constraint if exists events_selection_free;
alter table public.events add constraint events_selection_free
  check (registration_mode <> 'selection' or price = 0);
alter table public.events drop constraint if exists events_selection_text_length;
alter table public.events add constraint events_selection_text_length
  check (char_length(coalesce(selection_question, '')) <= 500
         and char_length(coalesce(commitment_text, '')) <= 300);

comment on column public.events.registration_mode is
  'first_come: seats go to the first registrants. selection: applicants wait for review (status applied).';
comment on column public.events.applicant_limit is
  'Selection mode only: registration closes once this many non-cancelled applications exist.';

alter table public.registrations
  add column if not exists selection_question text,
  add column if not exists selection_answer text,
  add column if not exists commitment_text text;

alter table public.registrations drop constraint if exists registrations_status_allowed;
alter table public.registrations add constraint registrations_status_allowed
  check (registration_status in ('pending_payment', 'confirmed', 'cancelled', 'applied'));

drop function if exists public.create_registration(text, text, text, text, text, text, boolean, text, text);

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
         registration.registration_status in ('confirmed', 'applied')
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


revoke all on function public.create_registration(text, text, text, text, text, text, boolean, text, text, text, boolean) from public;
revoke all on function public.create_registration(text, text, text, text, text, text, boolean, text, text, text, boolean) from anon;
revoke all on function public.create_registration(text, text, text, text, text, text, boolean, text, text, text, boolean) from authenticated;
grant execute on function public.create_registration(text, text, text, text, text, text, boolean, text, text, text, boolean) to service_role;
