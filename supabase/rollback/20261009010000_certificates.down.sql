-- Rollback for 20261009010000_certificates.sql.
-- Deploy the previous site and stop admin-certificate-issue / public-certificate
-- first. This deletes every issued certificate and breaks links already sent:
-- export what you need, empty the certificates bucket in the dashboard (Storage),
-- then run this.
drop table if exists public.certificates;
delete from storage.buckets where id = 'certificates';
