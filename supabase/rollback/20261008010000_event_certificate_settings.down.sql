-- Rollback for 20261008010000_event_certificate_settings.sql.
-- Deploy the previous site and admin-certificates first. This deletes every
-- event's certificate settings: empty the certificate-assets bucket in the
-- dashboard (Storage) before dropping it.
drop table if exists public.event_certificates;
delete from storage.buckets where id = 'certificate-assets';
