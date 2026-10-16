drop table if exists public.event_feedback;
drop index if exists public.certificates_feedback_token_idx;
alter table public.certificates drop column if exists feedback_token;
