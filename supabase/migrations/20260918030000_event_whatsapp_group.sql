-- Optional event-specific onboarding destination. It remains server-managed and is
-- never exposed through public event data or client-side event fixtures.
alter table public.events
  add column whatsapp_group_url text null;

comment on column public.events.whatsapp_group_url is
  'Optional HTTPS WhatsApp group invite URL, returned only to confirmed applicants.';
