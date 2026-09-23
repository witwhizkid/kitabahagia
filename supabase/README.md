# Supabase backend

## Data and security

- `public.events` stores authoritative event availability, price, capacity, and deadlines.
- `public.registrations` stores participant data and server-derived registration/payment state.
- `public.events.whatsapp_group_url` optionally stores one event-specific HTTPS WhatsApp invite. Set it manually in Supabase Table Editor under `events`; leave it null until the group is ready.
- RLS remains enabled. Browser roles cannot read or mutate these tables.
- `public.create_registration(...)` locks the event, checks its state/deadline/capacity, and inserts atomically. Only `service_role` may execute it.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only. Never expose it in browser code, public build variables, logs, or commits.

## Registration endpoint

`POST /functions/v1/create-registration`

```json
{
  "event_slug": "asa-raya-baduy",
  "name": "Nama Peserta",
  "phone": "+628123456789",
  "email": "peserta@example.com",
  "reason": "Ingin ikut berkontribusi.",
  "notes": null,
  "consent": true
}
```

Success (`201`):

```json
{
  "success": true,
  "registration": {
    "registration_code": "KB-20260915-A1B2C3",
    "event_slug": "asa-raya-baduy",
    "event_title": "Asa Raya Baduy",
    "amount": 0,
    "registration_status": "confirmed",
    "payment_status": "not_required"
  }
}
```

Errors: `INVALID_REQUEST` (`400`), `EVENT_NOT_FOUND` (`404`), `EVENT_NOT_OPEN`, `REGISTRATION_CLOSED`, `EVENT_FULL` (`409`), and `SERVER_ERROR` (`500`). Non-POST methods return `405`; CORS preflight returns `204`.

Free events are confirmed with `not_required`; paid events become `pending_payment` with `unpaid`. Amount and statuses always come from the database. Paid registrations use the deployed Midtrans Sandbox `create-payment` integration.

## Payment deadline and seat release

Migration `20260924010000_registration_payment_deadline.sql` gives every paid
registration a payment window:

- `registrations.payment_deadline = least(now() + 3 hours, events.registration_deadline)`,
  set by `create_registration` (since `20260925010000` the 3 hours is the
  per-event `payment_window_minutes`, default 15; see "Seat-hold rules"). Free registrations keep `NULL`. A paid
  registration with less than 5 minutes left to pay is refused as
  `REGISTRATION_CLOSED`.
- **Lazy seat release.** Both `create_registration` and `public-events`
  (`remaining_capacity`) count a registration as holding a seat when it is
  `confirmed`, or `pending_payment` with `payment_deadline` in the future (or
  `NULL`, the pre-migration behaviour). No job is needed for the quota to come
  back; unpaid rows simply stop counting. They stay `pending_payment` in the
  database until a cleanup job exists.
- `prepare_payment_attempt` refuses to create a new attempt within 30 seconds of
  the deadline (`PAYMENT_DEADLINE_PASSED`, HTTP `409` from `create-payment`).
  Existing `pending`/`creating` attempts are still returned so `create-payment`
  can reconcile a payment that settled at the last moment.
- QRIS lifetime is `min(60 minutes, payment_deadline)`, sent to Midtrans in
  seconds so the last QRIS ends exactly at the deadline. Midtrans allows 20
  seconds to 7 days for GoPay/Dynamic QRIS expiry
  (https://docs.midtrans.com/reference/gopay). The site creates the next QRIS
  automatically when one expires before the deadline.
- `create-payment` and `payment-status` return `payment_deadline`; the payment
  page counts down to it.
- **Late settlement.** `apply_midtrans_notification` still confirms a settlement
  that arrives after the deadline (the QR itself expired no later than the
  deadline, so the payment was made in time). If the released seat was taken in
  the meantime, the event can end up one confirmed registration over capacity;
  admins should review events whose confirmed count exceeds capacity. The
  payment page checks the status three more times (15 s, 1 min, 3 min) after
  showing the deadline screen, so such a payer still sees the confirmation.
- Backfill: existing `pending_payment` rows get
  `greatest(created_at + 3 hours, latest pending QR expiry)`. The event deadline
  is not applied retroactively.
- Rollback: `supabase/rollback/20260924010000_registration_payment_deadline.down.sql`
  (redeploy the previous Edge Functions first). Manual checks:
  `supabase/tests/20260924010000_payment_deadline_manual.sql`.

Deploy order: `supabase db push` (migration) → deploy `public-events`,
`payment-status`, `create-payment` → deploy the frontend. The frontend falls
back to the old QR-expiry countdown when `payment_deadline` is absent.

## Seat-hold rules

Migration `20260925010000_event_seat_hold_rules.sql` builds on the payment deadline:

- **Per-event window.** `events.payment_window_minutes` (default 15, allowed
  10–1440) replaces the fixed 3 hours:
  `payment_deadline = least(now() + payment_window_minutes, registration_deadline)`.
  Admins choose it in the event form ("Batas waktu bayar": 10/15/30 menit,
  1/3/24 jam); `admin-events` validates the integer range. `public-events`
  returns it so the registration page can say how long a seat is held.
  Existing registrations keep their stored `payment_deadline`. The 5-minute
  `REGISTRATION_CLOSED` rule now only triggers when the event's own
  registration deadline is less than 5 minutes away (the window is at least 10).
- **One active registration per person per event** (free events too).
  `create_registration` refuses `ALREADY_REGISTERED` (HTTP `409`) when the same
  event already has a registration with the same `lower(email)` **or** the same
  `normalize_phone(phone)` that is `confirmed`, or `pending_payment` whose
  `payment_deadline` is still in the future. Lapsed and cancelled registrations
  do not block, except a lapsed one whose QRIS was still payable in the last
  5 minutes (its late settlement could otherwise charge the person twice). The check runs after the event row is locked `FOR UPDATE`
  and after the capacity check (a full event answers `EVENT_FULL` without
  revealing whether the email or number is registered), so
  two concurrent sign-ups for the same event are serialised and the second one
  sees the first one's committed row. The message does not reveal which field
  matched.
- `public.normalize_phone(text)` keeps digits only and maps `08…`, `8…`, `62…`,
  `+62…`, `+62 0…` and `0062…` to `62…`; other international numbers
  (`+81…`, `+86…`) keep their own country code. Stored phone values are unchanged. Lookup indexes on
  `(event_id, lower(email))` and `(event_id, normalize_phone(phone))` are not
  unique, because older data may already contain duplicates.
- Rollback: `supabase/rollback/20260925010000_event_seat_hold_rules.down.sql`.
  Manual checks: `supabase/tests/20260925010000_seat_hold_rules_manual.sql`.

Deploy order: `supabase db push` → deploy `create-registration`, `admin-events`,
`public-events` → deploy the frontend (the page hides the seat-hold note when
the field is missing).

## Confirmed registration onboarding

`POST /functions/v1/payment-status` requires `registration_code` and the matching
`email`. It returns `whatsapp_group_url` only when the registration is confirmed
and its payment status is `paid` or `not_required`. The URL is returned only when
it is an HTTPS link on `chat.whatsapp.com`; pending, failed, expired, refunded,
cancelled, invalid, and malformed-link cases return `null`.

## Local and deployment commands

The function requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in its server environment.

```sh
supabase db reset
supabase functions serve create-registration --no-verify-jwt
supabase functions deploy create-registration --no-verify-jwt
supabase db push
```

`--no-verify-jwt` allows registration without Supabase Auth; validation and database access remain server-side. Public event fixtures do not contain WhatsApp invite URLs.

## Midtrans webhook

Set the Payment Notification URL in the Midtrans dashboard (Sandbox and Production each have their own setting) to:

`https://cmrdapfuqtjlmpepfwfq.supabase.co/functions/v1/midtrans-webhook`

The webhook accepts POST JSON notifications, checks Midtrans SHA-512 signatures with the server-only `MIDTRANS_SERVER_KEY`, and applies payment state through the service-role-only `apply_midtrans_notification` RPC. It rejects unknown orders, identity/amount mismatches, and stale status downgrades. Do not mark payment paid from the browser or by editing database rows.

## Midtrans environment

`create-payment` and `midtrans-webhook` read two function secrets:

- `MIDTRANS_ENV`: `sandbox` (https://api.sandbox.midtrans.com) or `production` (https://api.midtrans.com). Any other value makes both functions refuse to run.
- `MIDTRANS_SERVER_KEY`: the server key for that environment. A sandbox key (`SB-` prefix) is refused when `MIDTRANS_ENV=production`.

No code change or redeploy is needed to switch; secrets apply to the next request.

### Switching to production

1. Upgrade the Supabase project to a plan with daily backups before real money flows.
2. In the Midtrans **Production** dashboard: enable QRIS/GoPay, copy the production server key, and set the Payment Notification URL above.
3. Set the secrets (both in one command so the functions never see a mixed pair):
   `supabase secrets set MIDTRANS_ENV=production MIDTRANS_SERVER_KEY=<production server key>`
4. Make a real payment with a small-priced test event, confirm the registration becomes `confirmed`/`paid`, then refund it from the Midtrans dashboard and archive the test event.
5. Registrations and payment attempts created in sandbox stay in the database; their order IDs do not exist in production, so do not try to re-check them.

Rollback: `supabase secrets set MIDTRANS_ENV=sandbox MIDTRANS_SERVER_KEY=<sandbox server key>`.
