alter table public.event_feedback drop constraint if exists event_feedback_highlights_check;
alter table public.event_feedback add constraint event_feedback_highlights_check
  check (highlights <@ array['warga', 'teman', 'panitia', 'aktivitas', 'lokasi']::text[]);
