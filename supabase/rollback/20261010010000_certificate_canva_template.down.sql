-- Rollback for 20261010010000_certificate_canva_template.sql.
-- Deploy the previous site and admin-certificates / admin-certificate-issue first.
-- Events that used a Canva template fall back to the system template. Uploaded
-- designs stay in the certificate-assets bucket (delete them in Storage if needed).
alter table public.event_certificates
  drop constraint if exists event_certificates_template_mode,
  drop column if exists template_mode,
  drop column if exists template_path,
  drop column if exists name_layout,
  drop column if exists qr_layout;

update storage.buckets
set allowed_mime_types = array['image/png'],
    file_size_limit = 2097152
where id = 'certificate-assets';
