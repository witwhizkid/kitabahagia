-- Archive content without deleting records or related history.
alter table public.events
  add column if not exists archived_at timestamptz;

alter table public.stories
  add column if not exists archived_at timestamptz;

create index if not exists events_archived_at_idx
  on public.events (archived_at);

create index if not exists stories_archived_at_idx
  on public.stories (archived_at);