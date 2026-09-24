-- ROLLBACK for supabase/migrations/20260927010000_event_selection_mode.sql
-- Not a migration (kept outside supabase/migrations so it never runs automatically).
-- Order:
--   1. Redeploy the previous Edge Functions (create-registration, public-events,
--      admin-events, admin-registrations) so nothing reads or writes the new columns.
--   2. Decide what happens to applications still waiting for selection: the status
--      constraint below refuses 'applied', so this script cancels them first.
--   3. Run this file in the SQL Editor.
--   4. If the migration should be re-applied later, also run:
--      delete from supabase_migrations.schema_migrations where version = '20260927010000';
-- create_registration is restored verbatim from 20260925010000.
-- Dropping the columns discards selection settings and answers (destructive; run deliberately).

begin;

drop function if exists public.create_registration(text, text, text, text, text, text, boolean, text, text, text, boolean);

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

revoke all on function public.create_registration(text, text, text, text, text, text, boolean, text, text) from public;
revoke all on function public.create_registration(text, text, text, text, text, text, boolean, text, text) from anon;
revoke all on function public.create_registration(text, text, text, text, text, text, boolean, text, text) from authenticated;
grant execute on function public.create_registration(text, text, text, text, text, text, boolean, text, text) to service_role;

update public.registrations set registration_status = 'cancelled' where registration_status = 'applied';

alter table public.registrations drop constraint if exists registrations_status_allowed;
alter table public.registrations add constraint registrations_status_allowed
  check (registration_status in ('pending_payment', 'confirmed', 'cancelled'));

alter table public.registrations
  drop column if exists selection_question,
  drop column if exists selection_answer,
  drop column if exists commitment_text;

alter table public.events
  drop constraint if exists events_registration_mode_allowed,
  drop constraint if exists events_applicant_limit_positive,
  drop constraint if exists events_selection_min_chars_range,
  drop constraint if exists events_selection_text_length,
  drop constraint if exists events_selection_free,
  drop column if exists registration_mode,
  drop column if exists registration_opens_at,
  drop column if exists applicant_limit,
  drop column if exists announcement_at,
  drop column if exists selection_question,
  drop column if exists selection_min_chars,
  drop column if exists commitment_text;

commit;
