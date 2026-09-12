# Supabase backend foundation

## Schema

- `events` stores event identity, schedule, price, capacity, deadline, and lifecycle status.
- `registrations` stores attendee contact details, consent, registration/payment state, and the amount recorded at registration time. Each registration references one event.

Event statuses: `draft` (not published), `open` (accepting registrations), `full` (capacity reached), `closed` (registration stopped), `completed` (event finished), and `cancelled`.

Registration statuses: `pending_payment`, `confirmed`, or `cancelled`. Payment statuses: `not_required`, `unpaid`, `pending`, `paid`, `failed`, `expired`, or `refunded`.

## Apply migrations

With the Supabase CLI installed, use `supabase db reset` for the local database. For a hosted project, run `supabase link --project-ref <project-ref>` once and then `supabase db push`.

No event seed is included because the website data is not an authoritative source for future dates, prices, capacity, or availability.

## Security and future configuration

RLS is enabled and `anon`/`authenticated` privileges are revoked for both tables. There are no public policies. A future public event feed should add only a narrowly scoped `SELECT` grant and policy for `events`; registration mutations must stay behind trusted server-side code.

The future registration API will require `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. A client-facing event feed may additionally use `SUPABASE_PUBLISHABLE_KEY`. **Never expose `SUPABASE_SERVICE_ROLE_KEY` in browser code, committed files, logs, or public build variables.**

Next step: implement a server-side registration API or Supabase Edge Function that validates event availability and input before inserting a registration.
