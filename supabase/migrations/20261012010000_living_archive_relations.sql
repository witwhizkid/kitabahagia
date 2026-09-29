-- Minimal Living Archive relations. Existing events and stories intentionally remain unclassified/unlinked.
alter table public.events
  add column if not exists program_key text;

alter table public.events
  drop constraint if exists events_program_key_allowed;

alter table public.events
  add constraint events_program_key_allowed check (
    program_key is null or program_key in (
      'masyarakat_reguler',
      'adventure_unique',
      'impactful_action'
    )
  );

alter table public.stories
  add column if not exists event_id uuid;

alter table public.stories
  drop constraint if exists stories_event_id_fkey;

alter table public.stories
  add constraint stories_event_id_fkey
  foreign key (event_id) references public.events (id) on delete set null;

create index if not exists events_program_key_idx
  on public.events (program_key)
  where program_key is not null;

create index if not exists stories_event_id_idx
  on public.stories (event_id)
  where event_id is not null;

comment on column public.events.program_key is
  'Locked Kita Bahagia program family. NULL means not classified; historical rows are not backfilled.';

comment on column public.stories.event_id is
  'Optional related event for Living Archive continuity. ON DELETE SET NULL preserves editorial stories.';
