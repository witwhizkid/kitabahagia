-- "Tidak hadir": attendance becomes three states instead of two, so admins can
-- tell "did not come" apart from "not marked yet".
--
-- registrations:
--   absent_at  when a registrant was marked absent; null = not marked absent.
--   attended_at and absent_at are never both set. attendance_marked_by holds the
--   admin who set whichever one is set. Certificates still use attended_at only.
-- Function (service_role only, called by the admin-registrations Edge Function):
--   set_attendance(codes[], state, actor)  state = 'present' | 'absent' | 'clear'
--     for registrants of one event. Same rules as mark_attendance: confirmed
--     registrations only (others skipped and counted), from the event day (WIB).
--   mark_attendance(codes[], attended, actor) stays as a wrapper
--     (true = present, false = clear) for the previous Edge Function.
--
-- Expand-only. Rollback: supabase/rollback/20261015010000_registration_absence.down.sql

alter table public.registrations
  add column if not exists absent_at timestamptz;

alter table public.registrations
  drop constraint if exists registrations_attendance_single_state;
alter table public.registrations
  add constraint registrations_attendance_single_state
  check (attended_at is null or absent_at is null);

create or replace function public.set_attendance(
  p_registration_codes text[], p_state text, p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
  v_event_ids uuid[];
  v_codes text[];
  v_found integer;
  v_changed integer;
  v_eligible integer;
begin
  if p_state is null or p_state not in ('present', 'absent', 'clear') then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
  end if;

  select array_agg(distinct pg_catalog.upper(pg_catalog.btrim(code))) into v_codes
    from pg_catalog.unnest(p_registration_codes) as code
   where pg_catalog.btrim(coalesce(code, '')) <> '';
  if v_codes is null or pg_catalog.array_length(v_codes, 1) > 500 then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
  end if;

  select count(*)::integer, array_agg(distinct registration.event_id)
    into v_found, v_event_ids
    from public.registrations as registration
   where registration.registration_code = any (v_codes);
  if v_found <> pg_catalog.array_length(v_codes, 1)
     or v_event_ids is null or pg_catalog.array_length(v_event_ids, 1) <> 1 then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
  end if;

  select event.* into v_event
    from public.events as event
   where event.id = v_event_ids[1];
  if v_event.event_date is null
     or v_event.event_date > (pg_catalog.now() at time zone 'Asia/Jakarta')::date then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_STARTED';
  end if;

  select count(*)::integer into v_eligible
    from public.registrations as registration
   where registration.registration_code = any (v_codes)
     and registration.registration_status = 'confirmed';

  update public.registrations as registration
     set attended_at = case when p_state = 'present' then pg_catalog.now() end,
         absent_at = case when p_state = 'absent' then pg_catalog.now() end,
         attendance_marked_by = case when p_state = 'clear' then null else p_actor end
   where registration.registration_code = any (v_codes)
     and registration.registration_status = 'confirmed'
     and case p_state
           when 'present' then registration.attended_at is null
           when 'absent' then registration.absent_at is null
           else registration.attended_at is not null or registration.absent_at is not null
         end;
  get diagnostics v_changed = row_count;

  return (
    select pg_catalog.jsonb_build_object(
      'changed', v_changed,
      'unchanged', v_eligible - v_changed,
      'skipped', v_found - v_eligible,
      'attended', count(*) filter (where registration.attended_at is not null),
      'absent', count(*) filter (where registration.absent_at is not null)
    )
      from public.registrations as registration
     where registration.event_id = v_event.id
       and registration.registration_status = 'confirmed'
  );
end;
$$;

revoke all on function public.set_attendance(text[], text, uuid) from public, anon, authenticated;
grant execute on function public.set_attendance(text[], text, uuid) to service_role;

create or replace function public.mark_attendance(
  p_registration_codes text[], p_attended boolean, p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_attended is null then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
  end if;
  return public.set_attendance(
    p_registration_codes, case when p_attended then 'present' else 'clear' end, p_actor
  );
end;
$$;

revoke all on function public.mark_attendance(text[], boolean, uuid) from public, anon, authenticated;
grant execute on function public.mark_attendance(text[], boolean, uuid) to service_role;
