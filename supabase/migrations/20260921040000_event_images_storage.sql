insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-images',
  'event-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.admin_users
     where user_id = auth.uid()
       and is_active = true
       and role in ('admin', 'super_admin')
  );
$$;

revoke all on function public.is_active_admin() from public;
grant execute on function public.is_active_admin() to authenticated, service_role;

create policy "Public can read event images"
on storage.objects
for select
to public
using (bucket_id = 'event-images');

create policy "Active admins can upload event images"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'event-images' and public.is_active_admin());

create policy "Active admins can replace event images"
on storage.objects
for update
to authenticated
using (bucket_id = 'event-images' and public.is_active_admin())
with check (bucket_id = 'event-images' and public.is_active_admin());
