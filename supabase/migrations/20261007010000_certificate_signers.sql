-- Certificate signers (sertifikat tahap 2): the signatures admins upload once
-- per person and reuse on every certificate.
--
-- certificate_signers: one row per signer.
--   role     founder | project_leader | partner (a collaborating organisation's
--            signer; needs organization).
--   title    the line printed above the signature ("Founder Kita Bahagia",
--            "Project Leader", "Koordinator Marine Buddies Tangerang").
--   signature_path / stamp_path  objects in the private certificate-signatures
--            bucket; only the founder has a stamp.
--   is_active  deactivated signers cannot be picked for new certificates;
--            certificates already issued keep them.
--   consent_confirmed_at / created_by  the admin confirmed the signer's
--            permission, and who uploaded it (email snapshot).
-- Only Edge Functions (service_role) read or write the table and the bucket;
-- browsers get short-lived signed URLs for previews.
--
-- Expand-only. Rollback: supabase/rollback/20261007010000_certificate_signers.down.sql

create table if not exists public.certificate_signers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null,
  title text not null,
  organization text,
  signature_path text not null,
  stamp_path text,
  is_active boolean not null default true,
  consent_confirmed_at timestamptz not null default now(),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint certificate_signers_role check (role in ('founder', 'project_leader', 'partner')),
  constraint certificate_signers_name check (char_length(btrim(name)) between 2 and 120),
  constraint certificate_signers_title check (char_length(btrim(title)) between 2 and 120),
  constraint certificate_signers_organization check (
    organization is null or char_length(btrim(organization)) between 2 and 120),
  constraint certificate_signers_partner_organization check (role <> 'partner' or organization is not null),
  constraint certificate_signers_stamp_founder check (stamp_path is null or role = 'founder')
);

alter table public.certificate_signers enable row level security;
revoke all privileges on table public.certificate_signers from anon, authenticated;
grant select, insert, update, delete on table public.certificate_signers to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('certificate-signatures', 'certificate-signatures', false, 1048576, array['image/png'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- No storage.objects policies are created for this bucket. Anonymous and
-- authenticated browser roles cannot read or upload; Edge Functions use service_role.
