-- Certificate template from Canva (sertifikat, opsi template kedua).
--
-- event_certificates.template_mode  'system' (drawn by js/certificate.js, the
--          default and unchanged) or 'canva': Desain exports the whole certificate
--          for the event from Canva (ornaments, logo, number, description,
--          signatures and stamp included) with the name and QR area left empty.
--   template_path  that design, JPEG in the private certificate-assets bucket
--          (it carries real signatures, so it stays private).
--   name_layout / qr_layout  where the system writes each volunteer's name and
--          QR on it, in certificate pixels (2000×1414):
--          name {x, y, width, align: left|center, color: #rrggbb, size}
--          qr   {x, y, size, caption: boolean}
-- The bucket now also accepts JPEG (full designs are photos-like) up to 3 MB.
--
-- Expand-only. Rollback: supabase/rollback/20261010010000_certificate_canva_template.down.sql

alter table public.event_certificates
  add column if not exists template_mode text not null default 'system',
  add column if not exists template_path text,
  add column if not exists name_layout jsonb,
  add column if not exists qr_layout jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'event_certificates_template_mode') then
    alter table public.event_certificates
      add constraint event_certificates_template_mode check (template_mode in ('system', 'canva'));
  end if;
end $$;

update storage.buckets
set allowed_mime_types = array['image/png', 'image/jpeg'],
    file_size_limit = 3145728
where id = 'certificate-assets';
