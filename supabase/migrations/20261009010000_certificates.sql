-- Issued volunteer certificates (sertifikat tahap 4).
--
-- certificates: one per registration (only registrants marked present).
--   verification_code  random, unguessable; the QR and the private link
--            (kitabahagia.id/sertifikat?k=<code>) carry it. It never changes, so
--            re-issuing (e.g. a corrected name) keeps the same link.
--   recipient_name, certificate_number, event_title, event_date, event_end_at
--            snapshot at issue time, so later event edits do not change a
--            certificate that was already sent.
--   pdf_path  object in the private certificates bucket (drawn in the admin's
--            browser); issued_at is set once the PDF is stored. Public readers get
--            a short-lived signed URL through public-certificate.
--   email_sent_at / email_error  last Brevo send result.
-- Only Edge Functions (service_role) read or write the table and the bucket.
--
-- Expand-only. Rollback: supabase/rollback/20261009010000_certificates.down.sql

create table if not exists public.certificates (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null unique references public.registrations(id) on delete restrict,
  event_id uuid not null references public.events(id) on delete restrict,
  verification_code text not null unique,
  recipient_name text not null,
  certificate_number text not null,
  event_title text not null,
  event_date date not null,
  event_end_at timestamptz,
  pdf_path text,
  issued_by text not null,
  issued_at timestamptz,
  email_sent_at timestamptz,
  email_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint certificates_code check (verification_code ~ '^[A-Za-z0-9]{20,40}$'),
  constraint certificates_name check (char_length(btrim(recipient_name)) between 2 and 120)
);

create index if not exists certificates_event_idx on public.certificates (event_id);

alter table public.certificates enable row level security;
revoke all privileges on table public.certificates from anon, authenticated;
grant select, insert, update, delete on table public.certificates to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('certificates', 'certificates', false, 4194304, array['application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- No storage.objects policies: browsers only ever get signed URLs.
