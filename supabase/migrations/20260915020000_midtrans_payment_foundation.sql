-- Midtrans payment-attempt foundation. Provider callbacks and paid settlement are out of scope.

create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations (id) on delete restrict,
  provider text not null default 'midtrans',
  order_id text not null,
  provider_transaction_id text,
  amount integer not null,
  status text not null,
  provider_status text,
  qr_url text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint payment_attempts_order_id_key unique (order_id),
  constraint payment_attempts_provider_transaction_id_key unique (provider_transaction_id),
  constraint payment_attempts_amount_positive check (amount > 0),
  constraint payment_attempts_provider_midtrans check (provider = 'midtrans'),
  constraint payment_attempts_status_allowed check (
    status in ('creating', 'pending', 'paid', 'expired', 'failed', 'cancelled', 'refunded')
  )
);
create index payment_attempts_registration_id_idx on public.payment_attempts (registration_id);
create index payment_attempts_status_idx on public.payment_attempts (status);
create index payment_attempts_expires_at_idx on public.payment_attempts (expires_at);
create trigger payment_attempts_set_updated_at
before update on public.payment_attempts
for each row execute function public.set_updated_at();
alter table public.payment_attempts enable row level security;
revoke all privileges on table public.payment_attempts from public, anon, authenticated;
grant select, insert, update, delete on table public.payment_attempts to service_role;
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
create or replace function public.finalize_payment_attempt(
  p_attempt_id uuid,
  p_provider_transaction_id text,
  p_provider_status text,
  p_qr_url text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.payment_attempts%rowtype;
  v_registration public.registrations%rowtype;
begin
  select attempt.* into v_attempt
    from public.payment_attempts as attempt
   where attempt.id = p_attempt_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'PAYMENT_ATTEMPT_NOT_FOUND';
  end if;
  if v_attempt.status <> 'creating' then
    raise exception using errcode = 'P0001', message = 'PAYMENT_ATTEMPT_NOT_CREATING';
  end if;

  select registration.* into v_registration
    from public.registrations as registration
   where registration.id = v_attempt.registration_id
   for update;
  if v_registration.payment_status = 'paid' or v_registration.registration_status = 'confirmed' then
    raise exception using errcode = 'P0001', message = 'PAYMENT_ALREADY_PAID';
  end if;
  if v_registration.registration_status <> 'pending_payment'
     or v_registration.payment_status not in ('unpaid', 'pending', 'failed', 'expired') then
    raise exception using errcode = 'P0001', message = 'PAYMENT_NOT_ELIGIBLE';
  end if;

  update public.payment_attempts
     set provider_transaction_id = btrim(p_provider_transaction_id),
         provider_status = btrim(p_provider_status),
         status = 'pending',
         qr_url = btrim(p_qr_url),
         expires_at = p_expires_at
   where id = v_attempt.id;

  update public.registrations
     set payment_status = 'pending',
         payment_reference = v_attempt.order_id
   where id = v_registration.id
     and registration_status = 'pending_payment'
     and payment_status <> 'paid';

  return pg_catalog.jsonb_build_object(
    'registration_code', v_registration.registration_code,
    'amount', v_attempt.amount,
    'payment_status', 'pending',
    'qr_url', btrim(p_qr_url),
    'expires_at', p_expires_at,
    'order_id', v_attempt.order_id
  );
end;
$$;
create or replace function public.set_payment_attempt_terminal(
  p_attempt_id uuid,
  p_status text,
  p_provider_status text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated boolean;
begin
  if p_status not in ('failed', 'expired', 'cancelled') then
    raise exception using errcode = 'P0001', message = 'INVALID_TERMINAL_STATUS';
  end if;

  update public.payment_attempts
     set status = p_status,
         provider_status = nullif(btrim(p_provider_status), '')
   where id = p_attempt_id
     and status in ('creating', 'pending')
  returning true into v_updated;

  return pg_catalog.coalesce(v_updated, false);
end;
$$;
revoke all on function public.prepare_payment_attempt(text, text) from public, anon, authenticated;
revoke all on function public.finalize_payment_attempt(uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.set_payment_attempt_terminal(uuid, text, text) from public, anon, authenticated;
grant execute on function public.prepare_payment_attempt(text, text) to service_role;
grant execute on function public.finalize_payment_attempt(uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.set_payment_attempt_terminal(uuid, text, text) to service_role;
comment on table public.payment_attempts is 'Server-managed Midtrans payment attempts for registrations.';
comment on function public.prepare_payment_attempt(text, text) is 'Locks a paid registration and atomically reuses or creates a payment attempt.';
