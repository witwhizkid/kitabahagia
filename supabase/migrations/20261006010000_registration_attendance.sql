-- Attendance ("Tandai hadir"), the base for volunteer certificates: only people
-- marked present at the event get one.
--
-- registrations:
--   attended_at / attendance_marked_by  when and by which admin a registrant was
--   marked present; null = not marked (or unmarked again).
-- Function (service_role only, called by the admin-registrations Edge Function):
--   mark_attendance(codes[], attended, actor)  marks or unmarks registrants of
--     one event. Only confirmed registrations (free confirmed, paid, or accepted
--     in a selection) change; others are skipped and counted. The event must have
--     started (event day in WIB has come), so nobody is marked ahead of time.
--
-- Expand-only. Rollback: supabase/rollback/20261006010000_registration_attendance.down.sql

alter table public.registrations
  add column if not exists attended_at timestamptz,
  add column if not exists attendance_marked_by uuid;

create or replace function public.mark_attendance(
  p_registration_codes text[], p_attended boolean, p_actor uuid
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
  if p_attended is null then
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
     set attended_at = case when p_attended then pg_catalog.now() else null end,
         attendance_marked_by = case when p_attended then p_actor else null end
   where registration.registration_code = any (v_codes)
     and registration.registration_status = 'confirmed'
     and (registration.attended_at is null) = p_attended;
  get diagnostics v_changed = row_count;

  return pg_catalog.jsonb_build_object(
    'changed', v_changed,
    'unchanged', v_eligible - v_changed,
    'skipped', v_found - v_eligible,
    'attended', (
      select count(*)::integer
        from public.registrations as registration
       where registration.event_id = v_event.id
         and registration.registration_status = 'confirmed'
         and registration.attended_at is not null
    )
  );
end;
$$;

revoke all on function public.mark_attendance(text[], boolean, uuid) from public, anon, authenticated;
grant execute on function public.mark_attendance(text[], boolean, uuid) to service_role;
