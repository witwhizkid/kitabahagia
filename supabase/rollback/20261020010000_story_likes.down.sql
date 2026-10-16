drop function if exists public.set_story_like(text, text, text, boolean);
drop table if exists public.story_likes;
alter table public.stories drop column if exists like_count;
