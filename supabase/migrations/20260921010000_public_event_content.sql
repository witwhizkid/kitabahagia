-- Additive public event content fields for the future public-events endpoint.
-- Existing registration, payment, and onboarding columns remain unchanged.

alter table public.events
  add column if not exists category text,
  add column if not exists category_key text,
  add column if not exists registration_description text,
  add column if not exists activities text[] not null default '{}',
  add column if not exists benefits text[] not null default '{}',
  add column if not exists image_url text,
  add column if not exists image_alt text,
  add column if not exists timezone text not null default 'Asia/Jakarta',
  add column if not exists is_public boolean not null default false,
  add column if not exists end_at timestamptz;
