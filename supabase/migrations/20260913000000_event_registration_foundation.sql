-- Kita Bahagia event-registration foundation.
-- Public access is intentionally denied; writes will go through a trusted server endpoint.

create table public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  title text not null,
  description text,
  event_date date not null,
  start_time time,
  location text,
  price integer not null default 0,
  capacity integer,
  registration_deadline timestamptz,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint events_slug_key unique (slug),
  constraint events_price_nonnegative check (price >= 0),
  constraint events_capacity_positive check (capacity is null or capacity > 0),
  constraint events_status_allowed check (
    status in ('draft', 'open', 'full', 'closed', 'completed', 'cancelled')
  )
);

create table public.registrations (
  id uuid primary key default gen_random_uuid(),
  registration_code text not null,
  event_id uuid not null references public.events (id) on delete restrict,
  name text not null,
  phone text not null,
  email text not null,
  reason text,
  notes text,
  consent boolean not null,
  registration_status text not null,
  payment_status text not null,
  amount integer not null,
  payment_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint registrations_code_key unique (registration_code),
  constraint registrations_amount_nonnegative check (amount >= 0),
  constraint registrations_consent_required check (consent is true),
  constraint registrations_status_allowed check (
    registration_status in ('pending_payment', 'confirmed', 'cancelled')
  ),
  constraint registrations_payment_status_allowed check (
    payment_status in (
      'not_required',
      'unpaid',
      'pending',
      'paid',
      'failed',
      'expired',
      'refunded'
    )
  )
);

-- UNIQUE constraints already provide indexes for events.slug and
-- registrations.registration_code, so duplicate indexes are not created.
create index events_status_idx on public.events (status);
create index events_event_date_idx on public.events (event_date);

create index registrations_event_id_idx on public.registrations (event_id);
create index registrations_email_idx on public.registrations (email);
create index registrations_phone_idx on public.registrations (phone);
create index registrations_status_idx on public.registrations (registration_status);
create index registrations_payment_status_idx on public.registrations (payment_status);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

create trigger events_set_updated_at
before update on public.events
for each row
execute function public.set_updated_at();

create trigger registrations_set_updated_at
before update on public.registrations
for each row
execute function public.set_updated_at();

alter table public.events enable row level security;
alter table public.registrations enable row level security;

-- Supabase may grant exposed-schema privileges by default. Remove all public-client
-- privileges as defense in depth; service_role remains reserved for trusted servers.
revoke all privileges on table public.events from anon, authenticated;
revoke all privileges on table public.registrations from anon, authenticated;

grant select, insert, update, delete on table public.events to service_role;
grant select, insert, update, delete on table public.registrations to service_role;

-- No public policies are created in this phase. If event discovery becomes public,
-- grant SELECT on events and add a narrow SELECT policy (for example, only published
-- statuses) in a separate reviewed migration. Never add registration write policies
-- for anon/authenticated clients; route registration writes through trusted code.
