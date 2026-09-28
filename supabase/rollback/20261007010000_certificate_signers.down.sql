-- Rollback for 20261007010000_certificate_signers.sql.
-- Deploy the previous site (without the Sertifikat tab) and stop using
-- admin-certificates first. This deletes every uploaded signature: empty the
-- certificate-signatures bucket in the dashboard (Storage) before dropping it.
drop table if exists public.certificate_signers;
delete from storage.buckets where id = 'certificate-signatures';
