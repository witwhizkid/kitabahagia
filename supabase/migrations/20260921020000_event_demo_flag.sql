alter table public.events
  add column if not exists is_demo boolean not null default false;
