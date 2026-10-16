-- Post-event feedback (Oct 2026). The certificate email links each present volunteer to
-- kitabahagia.id/feedback?t=<feedback_token>; one answer per certificate, editable.
-- Only Edge Functions (service_role) read or write; public-feedback never returns names of others.
-- Rollback: supabase/rollback/20261022010000_event_feedback.down.sql

alter table public.certificates
  add column if not exists feedback_token text not null default replace(gen_random_uuid()::text, '-', '');
create unique index if not exists certificates_feedback_token_idx on public.certificates (feedback_token);

create table if not exists public.event_feedback (
  certificate_id uuid primary key references public.certificates(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  highlights text[] not null default '{}'
    check (highlights <@ array['warga', 'teman', 'panitia', 'aktivitas', 'lokasi']::text[]),
  message text check (message is null or char_length(message) <= 1000),
  anonymous boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists event_feedback_event_idx on public.event_feedback (event_id, updated_at desc);

alter table public.event_feedback enable row level security;
revoke all privileges on table public.event_feedback from anon, authenticated;
grant select, insert, update, delete on table public.event_feedback to service_role;
