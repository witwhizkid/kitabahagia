-- Rollback for 20261001010000_selection_cv_setting.sql.
begin;

create or replace function public.create_registration(
  p_event_slug text, p_name text, p_phone text, p_email text,
  p_reason text, p_notes text, p_consent boolean,
  p_domicile text default null, p_institution text default null,
  p_selection_answer text default null, p_commitment boolean default null,
  p_instagram_proof_path text default null,
  p_cv_path text default null, p_portfolio_url text default null
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
  v_proof_path text := nullif(btrim(p_instagram_proof_path), '');
  v_cv_path text := nullif(btrim(p_cv_path), '');
  v_portfolio_url text := nullif(btrim(p_portfolio_url), '');
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
    if v_proof_path is null
       or v_proof_path !~ ('^' || v_event.slug || '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$') then
      raise exception using errcode = 'P0001', message = 'INVALID_INSTAGRAM_PROOF';
    end if;
  elsif v_proof_path is not null then
    raise exception using errcode = 'P0001', message = 'INVALID_INSTAGRAM_PROOF';
  end if;
  -- CV and portfolio link are optional and only belong to selection applications.
  if v_cv_path is not null and (not v_selection
     or v_cv_path !~ ('^' || v_event.slug || '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$')) then
    raise exception using errcode = 'P0001', message = 'INVALID_CV';
  end if;
  if v_portfolio_url is not null and (not v_selection
     or char_length(v_portfolio_url) > 500 or v_portfolio_url !~ '^https://[^[:space:]]+$') then
    raise exception using errcode = 'P0001', message = 'INVALID_PORTFOLIO_URL';
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
        payment_deadline, selection_question, selection_answer, commitment_text, instagram_proof_path,
        cv_path, portfolio_url
      ) values (
        v_code, v_event.id, btrim(p_name), btrim(p_phone), pg_catalog.lower(btrim(p_email)),
        nullif(btrim(p_domicile), ''), nullif(btrim(p_institution), ''),
        nullif(btrim(p_reason), ''), nullif(btrim(p_notes), ''), true,
        v_registration_status, v_payment_status, v_event.price,
        v_payment_deadline,
        case when v_selection then v_event.selection_question end,
        case when v_selection then v_answer end,
        case when v_selection and p_commitment is true then v_event.commitment_text end,
        case when v_selection then v_proof_path end,
        v_cv_path, v_portfolio_url
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
revoke all on function public.create_registration(text, text, text, text, text, text, boolean, text, text, text, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.create_registration(text, text, text, text, text, text, boolean, text, text, text, boolean, text, text, text) to service_role;

alter table public.events drop constraint if exists events_cv_note_length;
alter table public.events
  drop column if exists cv_requested,
  drop column if exists cv_note;

commit;
