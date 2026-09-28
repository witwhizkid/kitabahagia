-- Per-event certificate settings (sertifikat tahap 3). One row per event, edited
-- in admin → Sertifikat before issuing.
--
-- event_certificates
--   certificate_number  typed by the admin ("13.044/KB/VII/2026"); the same for
--            every volunteer of the event. Its parts mean nothing to the system.
--   description  the admin's sentences after the automatic first sentence
--            (event, date, location, partner come from the event row).
--   ornament_preset / ornament_color  drawn right-hand ornament; ornament_path
--            (a transparent PNG from Desain) replaces the preset when set.
--   logo_variant  color or white Kita Bahagia logo (white on dark ornaments).
--   founder_id / project_leader_id / partner_signer_id  signers from
--            certificate_signers; a partner makes it a collaboration certificate
--            (partner logo in partner_logo_path, organization in the text).
--   updated_by  admin email snapshot.
-- Images live in the private certificate-assets bucket; only Edge Functions
-- (service_role) read or write the table and the bucket.
--
-- Expand-only. Rollback: supabase/rollback/20261008010000_event_certificate_settings.down.sql

create table if not exists public.event_certificates (
  event_id uuid primary key references public.events(id) on delete cascade,
  certificate_number text,
  description text,
  ornament_preset text not null default 'kelopak',
  ornament_color text not null default 'maroon',
  ornament_path text,
  logo_variant text not null default 'color',
  founder_id uuid references public.certificate_signers(id),
  project_leader_id uuid references public.certificate_signers(id),
  partner_signer_id uuid references public.certificate_signers(id),
  partner_logo_path text,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_certificates_number check (
    certificate_number is null or certificate_number ~ '^[0-9A-Za-z][0-9A-Za-z./ -]{0,39}$'),
  constraint event_certificates_description check (
    description is null or char_length(description) between 1 and 500),
  constraint event_certificates_ornament_preset check (ornament_preset in ('kelopak', 'balok')),
  constraint event_certificates_ornament_color check (ornament_color in ('maroon', 'emas', 'hijau', 'biru')),
  constraint event_certificates_logo_variant check (logo_variant in ('color', 'white'))
);

alter table public.event_certificates enable row level security;
revoke all privileges on table public.event_certificates from anon, authenticated;
grant select, insert, update, delete on table public.event_certificates to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('certificate-assets', 'certificate-assets', false, 2097152, array['image/png'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- No storage.objects policies for this bucket: browsers get signed URLs only.
