-- Feedback "Yang paling berkesan?" grows from 5 to 8 choices (Oct 2026). Old keys keep their meaning.
-- Rollback: supabase/rollback/20261023010000_event_feedback_highlights.down.sql
alter table public.event_feedback drop constraint if exists event_feedback_highlights_check;
alter table public.event_feedback add constraint event_feedback_highlights_check
  check (highlights <@ array['warga', 'aktivitas', 'teman', 'pengalaman', 'panitia', 'manfaat', 'lokasi', 'suasana']::text[]);
