-- Atomic trusted registration operation for the create-registration Edge Function.

create or replace function public.create_registration(
  p_event_slug text, p_name text, p_phone text, p_email text,
  p_reason text, p_notes text, p_consent boolean
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
      || pg_catalog.substring(pg_catalog.upper(pg_catalog.replace(gen_random_uuid()::text, '-', '')) from 1 for 6);
    begin
      insert into public.registrations (
        registration_code, event_id, name, phone, email, reason, notes, consent,
        registration_status, payment_status, amount
      ) values (
        v_code, v_event.id, btrim(p_name), btrim(p_phone), pg_catalog.lower(btrim(p_email)),
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

revoke all on function public.create_registration(text, text, text, text, text, text, boolean) from public;
revoke all on function public.create_registration(text, text, text, text, text, text, boolean) from anon;
revoke all on function public.create_registration(text, text, text, text, text, text, boolean) from authenticated;
grant execute on function public.create_registration(text, text, text, text, text, text, boolean) to service_role;

comment on function public.create_registration(text, text, text, text, text, text, boolean)
is 'Creates one registration atomically after locking and validating its event; trusted service_role only.';
