alter table public.events drop constraint if exists events_documentation_full_url_https;
alter table public.events drop column if exists documentation_full_url;
