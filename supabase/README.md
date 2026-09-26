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

## Selection mode

Migration `20260927010000_event_selection_mode.sql` (rollback in
`supabase/rollback/`, manual checks in `supabase/tests/20260927010000_selection_mode_manual.sql`):

- `events.registration_mode`: `first_come` (default, unchanged behaviour) or
  `selection` (free events only; enforced in `create_registration` and `admin-events`).
- `events.registration_opens_at` (both modes): `create_registration` answers
  `REGISTRATION_NOT_OPEN` before it.
- Selection events: an application gets `registration_status = 'applied'`,
  `payment_status = 'not_required'` and holds **no seat**; `capacity` means the
  number accepted later. `applicant_limit` caps non-cancelled applications
  (`APPLICANTS_FULL`), counted while the event row is locked.
- `selection_question` + `selection_min_chars` and `commitment_text` are asked on
  the form; a short answer or an unticked commitment is `INVALID_ANSWER`. The
  question, answer and commitment text are copied onto the registration.
- An `applied` registration blocks a second application by the same email or
  normalised WhatsApp number (`ALREADY_REGISTERED`).
- `public-events` never exposes counts for selection events: `capacity` and
  `remaining_capacity` are null and only `applicants_full` (boolean) is sent.
  It embeds `registrations` twice under two aliases (`seats`, `applicants`);
  both must stay aliased, or PostgREST applies the filters to the wrong embed.

Deploy order: run the migration first (the deployed `create-registration` keeps
working because the new RPC parameters default to null), then deploy
`create-registration`, `public-events`, `admin-events` and `admin-registrations`,
then the site.

## Instagram proof for free selection events

Migration `20260929010000_instagram_proof.sql` adds nullable
`registrations.instagram_proof_path` and the private `instagram-proofs` Storage
bucket (JPG, PNG, WebP; 2 MiB object limit). It creates no browser Storage
policies: anonymous/authenticated roles cannot upload or read these objects.
The database RPC requires a path matching the event slug and a random UUID only
for free selection events; every other event rejects a supplied path. Existing
JSON registration calls keep working because the new RPC parameter defaults to
null. Rollback is in `supabase/rollback/20260929010000_instagram_proof.down.sql`;
it stops if the bucket still contains proof files so rollback cannot silently
delete participant evidence. Manual checks:
`supabase/tests/20260929010000_instagram_proof_manual.sql`.

Only the `create-registration` Edge Function accepts multipart, and only after
checking that the event is free + selection. It caps the multipart body, checks
MIME and file signature, caps the image at 2 MiB, uploads with the server-only
service-role key under `<event-slug>/<random-uuid>.<ext>`, then calls
`create_registration`. If the RPC fails, it removes the just-uploaded object.
All other registrations keep the JSON path. A function crash between upload and
RPC can leave a private orphan; cleanup automation is a future follow-up.

`admin-registrations?proof=<registration_code>` reuses the normal active-admin
verification, fetches the object path only for a free selection registration,
and returns a 10-minute signed URL. The list response never includes the proof
path or signed URL. Rate limiting for anonymous registration/file upload is a
pre-launch security follow-up; this feature does not add a separate limiter.

Rollout order: apply the migration, deploy `create-registration`, deploy
`admin-registrations`, then deploy the static site. No payment function changes
are required. Do not expose `SUPABASE_SERVICE_ROLE_KEY` in the site.

## Selection extras: requirements, CV and portfolio link

Migration `20260930010000_selection_extras.sql` adds:

- `events.selection_requirements text[]` ("Persyaratan jika lolos"). Admin writes
  one item per line; `**teks**` renders bold on the public page (as DOM text, never
  HTML). `public-events` sends it only for selection events. The migration fills
  it for selection events that already existed with the text the page used to
  show as a static placeholder.
- Optional `registrations.cv_path` (private bucket `selection-cvs`, PDF only,
  5 MiB) and `registrations.portfolio_url` (`https://`, max 500 chars). The RPC
  accepts both only for selection events; the path must be
  `<event-slug>/<uuid>.pdf`.

`create-registration` takes the CV as an optional `cv` part of the same
multipart request as the Instagram proof. It checks `application/pdf` plus the
`%PDF-` signature, uploads it after the proof, and removes both objects if the
RPC fails. `admin-registrations?proof=<code>` now returns `{ proof, cv }`, each a
10-minute signed URL or null. The portfolio link is part of the normal list row
and CSV export. Rollback:
`supabase/rollback/20260930010000_selection_extras.down.sql` (stops while
`selection-cvs` has files). Manual checks:
`supabase/tests/20260930010000_selection_extras_manual.sql`.

Rollout order: apply the migration, deploy `create-registration`,
`admin-registrations`, `admin-events` and `public-events`, then the static site.

Migration `20261001010000_selection_cv_setting.sql` adds `events.cv_requested`
(default false; set true for selection events that existed) and `events.cv_note`
(max 300 chars, shown under the portfolio link; empty = built-in text). The RPC
rejects a CV or portfolio link when `cv_requested` is off. Deploy `admin-events`
and `public-events` after the migration, then the site.

## Registration rate limit

Migration `20261002010000_registration_rate_limit.sql` adds
`registration_attempts` (HMAC-SHA-256 of the client IP keyed with the
service role key, + time; service role
only, rows older than a day are deleted on each call) and
`check_registration_rate(ip_hash)`: at most 30 attempts per 10 minutes and 200 per
24 hours per IP (relaxed from 5/20 by `20261003010000_registration_rate_limit_relax.sql`,
because carrier CGNAT and campus wifi put many real people behind one IP) (taken from `cf-connecting-ip`, then `x-real-ip`, then the
first `x-forwarded-for` entry). `create-registration` calls it before reading the request body
and answers `429 RATE_LIMITED` when over. The check fails open (a database or
network error lets the registration through), so the function can be deployed
before the migration. To change the numbers, add a migration that replaces the
function. Manual check: `supabase/tests/20261003010000_registration_rate_limit_relax_manual.sql`.
Rollback: `supabase/rollback/20261003010000_registration_rate_limit_relax.down.sql` (back to
5/20), or `supabase/rollback/20261002010000_registration_rate_limit.down.sql` (remove the limit).

## Event "last edited by"

Migration `20261004010000_event_last_edited.sql` adds `events.last_edited_by`
(the admin's email, kept as a snapshot) and `events.last_edited_at`. Only
`admin-events` sets them, on create, edit, archive and restore; clients cannot
send them. The admin event list shows "Diubah 26 Sep 2026, 14.05 oleh <nama>".
Events edited before the migration show nothing until their next edit.
**Deploy order:** run the migration first, then deploy `admin-events` (the new
function selects these columns). Rollback: deploy the previous `admin-events`,
then `supabase/rollback/20261004010000_event_last_edited.down.sql`.

## Event location link ("Petunjuk arah")

Migration `20261005010000_event_location_url.sql` adds optional
`events.location_url` (https only, DB check). `admin-events` accepts only Google
Maps links (`maps.app.goo.gl`, `goo.gl`, `maps.google.com`, `google.com/maps…`, `google.co.id/maps…`)
and `null` to clear; `public-events` returns it and the registration page shows
"Petunjuk arah ↗" under the location. **Deploy order:** migration first, then
`admin-events` and `public-events` (both select the column), then the site.
Rollback: deploy the previous functions, then
`supabase/rollback/20261005010000_event_location_url.down.sql`.

## Database backup

The free Supabase plan has no restorable daily backups, so export manually,
for example after every event and before running a migration.

One-time setup (Windows): install PostgreSQL 17 from postgresql.org and select
only "Command Line Tools"; reopen the terminal so `pg_dump` is on PATH.

Each backup:
1. Supabase → Connect (top bar) → Connection string → **Session pooler**; copy the
   URI and replace `[YOUR-PASSWORD]` with the database password (Project
   Settings → Database → reset it if unknown).
2. `powershell -ExecutionPolicy Bypass -File scripts\backup-db.ps1` and paste
   the URI when asked (or set `$env:KB_DB_URL` for the session).
3. The file lands in `backups\` (git- and Vercel-ignored). Copy it somewhere
   else too; it holds participants' personal data, so keep it private.

The dump is the `public` schema (schema + data). It does not include Storage
files (posters, story photos, Instagram proofs, CVs) or admin logins in `auth`;
admins can be re-invited. Restore into an empty project with
`pg_restore --dbname="<uri>" --no-owner --no-privileges <file>.dump`.
It prints `schema "public" already exists`; that error is expected and harmless.

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

## QRIS display

`create-payment` returns `qr_string`, the raw QRIS payload from the Midtrans charge
response, next to `qr_url`. The site draws its own QR code from `qr_string`
(js/vendor/qrcode-generator.min.js, MIT) and builds the "Unduh QRIS" image locally,
so it no longer shows the Midtrans poster image. `qr_string` is stored in
`payment_attempts.qr_string` (migration 20260926010000) so a reused attempt can return
it again. Attempts without `qr_string` (created before that migration, or if storing
it failed) fall back to the `qr_url` image.

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
