create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  excerpt text,
  body text not null,
  cover_image_url text,
  cover_image_alt text,
  status text not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint stories_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint stories_status_allowed check (status in ('draft', 'published')),
  constraint stories_title_not_blank check (length(btrim(title)) > 0),
  constraint stories_body_not_blank check (length(btrim(body)) > 0)
);

create index if not exists stories_public_order_idx
  on public.stories (status, published_at desc, slug);

create or replace function public.set_story_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists stories_set_updated_at on public.stories;
create trigger stories_set_updated_at
before update on public.stories
for each row execute function public.set_story_updated_at();

alter table public.stories enable row level security;

revoke all privileges on table public.stories from anon, authenticated;
grant select, insert, update, delete on table public.stories to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'story-images',
  'story-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Public can read story images"
on storage.objects
for select
to public
using (bucket_id = 'story-images');

create policy "Active admins can upload story images"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'story-images' and public.is_active_admin());

create policy "Active admins can replace story images"
on storage.objects
for update
to authenticated
using (bucket_id = 'story-images' and public.is_active_admin())
with check (bucket_id = 'story-images' and public.is_active_admin());

comment on table public.stories is 'Editorial Kisah content managed through authenticated Edge Functions.';
comment on column public.stories.body is 'Plain editorial text. Paragraphs are separated by preserved newlines.';
