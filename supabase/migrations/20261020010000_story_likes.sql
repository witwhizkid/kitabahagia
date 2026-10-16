-- Hearts on a Kisah (the floating "♥ n · Bagikan" capsule on kisah-detail).
-- No accounts: one heart per device id (random, kept in the browser) per story. Only keyed hashes
-- of the device id and of the IP are stored. Service role only; public-stories reads/writes it.
-- Rollback: supabase/rollback/20261020010000_story_likes.down.sql

alter table public.stories add column if not exists like_count integer not null default 0;

create table if not exists public.story_likes (
  story_id uuid not null references public.stories(id) on delete cascade,
  device_hash text not null,
  ip_hash text,
  created_at timestamptz not null default now(),
  primary key (story_id, device_hash)
);
create index if not exists story_likes_ip_time_idx on public.story_likes (ip_hash, created_at);
alter table public.story_likes enable row level security;
revoke all on public.story_likes from public, anon, authenticated;

-- Sets or clears one device's heart on a published story and returns the new count.
-- Returns null for an unknown/unpublished story. Over 60 hearts per IP per hour, a new heart is
-- ignored (the current count is returned), so a script cannot inflate the number quickly.
create or replace function public.set_story_like(p_slug text, p_device_hash text, p_ip_hash text, p_liked boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story uuid;
  v_changed integer := 0;
  v_count integer;
begin
  if p_device_hash is null or char_length(p_device_hash) <> 64 then
    return null;
  end if;
  select id into v_story from public.stories
   where slug = p_slug and status = 'published' and archived_at is null;
  if v_story is null then
    return null;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_story::text));
  if p_liked then
    if p_ip_hash is null or (select count(*) from public.story_likes
          where ip_hash = p_ip_hash and created_at > pg_catalog.now() - interval '1 hour') < 60 then
      insert into public.story_likes (story_id, device_hash, ip_hash)
      values (v_story, p_device_hash, p_ip_hash)
      on conflict do nothing;
      get diagnostics v_changed = row_count;
    end if;
  else
    delete from public.story_likes where story_id = v_story and device_hash = p_device_hash;
    get diagnostics v_changed = row_count;
    v_changed := -v_changed;
  end if;
  update public.stories set like_count = greatest(0, like_count + v_changed)
   where id = v_story
   returning like_count into v_count;
  return v_count;
end;
$$;
revoke all on function public.set_story_like(text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.set_story_like(text, text, text, boolean) to service_role;
