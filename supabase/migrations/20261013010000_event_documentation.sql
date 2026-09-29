-- Event documentation: a public Google Drive folder link plus up to five
-- highlight photos (public event-images URLs) shown after the event.
alter table public.events
  add column if not exists documentation_url text,
  add column if not exists documentation_photos jsonb not null default '[]'::jsonb;

alter table public.events
  drop constraint if exists events_documentation_url_https;
alter table public.events
  add constraint events_documentation_url_https
  check (documentation_url is null or documentation_url ~ '^https://');

alter table public.events
  drop constraint if exists events_documentation_photos_shape;
alter table public.events
  add constraint events_documentation_photos_shape
  check (jsonb_typeof(documentation_photos) = 'array' and jsonb_array_length(documentation_photos) <= 5);

comment on column public.events.documentation_url is
  'Public (view-only) Google Drive folder with the curated event photos.';
comment on column public.events.documentation_photos is
  'Up to 5 highlight photos: [{ "url": public event-images URL, "alt": text }].';
