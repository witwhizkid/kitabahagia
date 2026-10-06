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
  10–1440; 5–1440 since `20261016010000_payment_window_five_minutes.sql`) replaces the fixed 3 hours:
  `payment_deadline = least(now() + payment_window_minutes, registration_deadline)`.
  Admins choose it in the event form ("Batas waktu bayar": 5/10/15/30 menit,
  1/3/24 jam); `admin-events` validates the integer range. `public-events`
  returns it so the registration page can say how long a seat is held.
  Existing registrations keep their stored `payment_deadline`. The 5-minute
  `REGISTRATION_CLOSED` rule now only triggers when the event's own
  registration deadline is less than 5 minutes away (the window is at least 5).
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

## Attendance ("Tandai hadir")

Migration `20261006010000_registration_attendance.sql` adds
`registrations.attended_at` / `attendance_marked_by` and
`mark_attendance(codes[], attended, actor)` (service_role only). It is the base
for volunteer certificates: only registrants marked present get one.
`admin-registrations` returns `attended_at` in the list and accepts
`POST { registration_codes, attended: true | false }`. Rules, enforced in the
database: one event per call (≤500 codes, all must exist), only `confirmed`
registrations change (others are skipped and counted), and the event day (WIB)
must have come (`EVENT_NOT_STARTED`, 409). The response is
`{ attendance: { changed, unchanged, skipped, attended } }`.
In admin → Pendaftar, choosing one event shows checkboxes for every event
mode; the command bar has "Tandai hadir" / "Batal hadir" (disabled before the
event day), rows show "✓ Hadir", the Detail panel shows when it was marked, and
the CSV has a "Hadir" column. **Deploy order:** migration first, then
`admin-registrations`, then the site. Rollback: deploy the previous
`admin-registrations`, then
`supabase/rollback/20261006010000_registration_attendance.down.sql` (this
deletes the attendance marks).

"Tidak hadir" (migration `20261015010000_registration_absence.sql`) makes it
three states: `registrations.absent_at` (never set together with
`attended_at`, check constraint) and `set_attendance(codes[], state, actor)`
with state `present` | `absent` | `clear`, same rules as above;
`mark_attendance` stays as a wrapper (true = present, false = clear).
`admin-registrations` returns `absent_at` and now accepts
`POST { registration_codes, attendance: "present" | "absent" | "clear" }`
(the old `attended` body is rejected); the response adds `absent`. Admin: the
command bar has "Tandai hadir" / "Tidak hadir" / "Kosongkan tanda", rows show
"✕ Tidak hadir", the summary counts Hadir · Tidak hadir · Belum ditandai, the
Detail panel has both buttons (clicking the current state clears it), the CSV
"Hadir" column says Ya / Tidak, and the Beranda reminder stays until every
confirmed registrant is marked. Certificates still use `attended_at` only.
**Deploy order:** migration, then `admin-registrations`, then the site (between
the last two, the old admin page cannot save attendance). Rollback: previous
`admin-registrations`, then
`supabase/rollback/20261015010000_registration_absence.down.sql` (deletes the
"Tidak hadir" marks, restores the two-state `mark_attendance`).

## Certificate signers ("Sertifikat" → daftar tanda tangan)

Migration `20261007010000_certificate_signers.sql` adds
`certificate_signers` (name, role `founder | project_leader | partner`, title
printed above the signature, organization for partners, `signature_path`,
`stamp_path` for the founder only, `is_active`, `consent_confirmed_at`,
`created_by` email) and the private bucket `certificate-signatures` (PNG only,
1 MB, no Storage policies). Only service_role touches either.
Edge Function `admin-certificates` (admin/super_admin, `verify_jwt = false`,
own auth check): `GET` lists signers with 10-minute signed `signature_url` /
`stamp_url` (paths are never returned); `POST` multipart
`name, role, title, organization?, consent=true, signature, stamp?` checks
the PNG bytes and size, uploads to `{id}/signature.png` / `{id}/stamp.png`,
then inserts (uploads are removed if the insert fails); `PATCH ?id=` JSON
changes `name`, `title`, `organization` or `is_active`; `DELETE ?id=` removes
a **deactivated** signer (row + images) unless an `event_certificates` row still
points at it (`SIGNER_ACTIVE` / `SIGNER_IN_USE`, 409). Issued certificates keep
their PDF either way; deactivated signers cannot be picked for new events.
In admin → Sertifikat, the browser turns a phone photo of the signature into a
transparent PNG (paper brightness estimated from the photo, ink kept, cropped,
≤1200 px) and previews it as a certificate signature column; saving needs the
consent checkbox. **Deploy order:** migration, then `admin-certificates`, then
the site. Rollback: deploy the previous site, empty the bucket in the
dashboard, then `supabase/rollback/20261007010000_certificate_signers.down.sql`.

## Certificate settings per event (sertifikat tahap 3)

Migration `20261008010000_event_certificate_settings.sql` adds
`event_certificates` (one row per event: `certificate_number` typed by the
admin, `description` = the admin's sentences after the automatic first
sentence, `ornament_preset` kelopak/balok + `ornament_color`
maroon/emas/hijau/biru, optional custom `ornament_path`, `logo_variant`
color/white, `founder_id` / `project_leader_id` / `partner_signer_id` from
`certificate_signers`, optional `partner_logo_path`, `updated_by`) and the
private bucket `certificate-assets` (PNG, 2 MB, no policies).
`admin-certificates` handles it with `?event=<slug>`: `GET` returns
`{ settings | null, signers }` with signed `ornament_url` / `partner_logo_url`;
`POST` (multipart) saves every field at once, optional `ornament` /
`partner_logo` PNGs (stored under a new name each time; the replaced file is
deleted only after the row is saved) and `remove_ornament` /
`remove_partner_logo = "true"`. Signer ids must match their role; an inactive
signer can stay on the event it was already chosen for but cannot be newly
picked (`INVALID_SIGNER`). Settings may be incomplete; issuing will require a
number, founder and Project Leader.
The certificate itself is drawn by `js/certificate.js` (canvas 2000×1414,
`KBCertificate.render`), which admin → Sertifikat uses for the live preview
with a sample name. Fonts are Plus Jakarta Sans + Lexend (Google Fonts) until
Garet is self-hosted. **Deploy order:** migration, `admin-certificates`, site.
Rollback: previous site + function, empty the bucket, then
`supabase/rollback/20261008010000_event_certificate_settings.down.sql`.

## Certificate template from Canva

Migration `20261010010000_certificate_canva_template.sql` adds
`event_certificates.template_mode` (`system` default | `canva`),
`template_path`, `name_layout` and `qr_layout` (jsonb, certificate pixels on
2000×1414: name `{x, y, width, align, color, size}`, QR `{x, y, size, caption}`)
and lets the `certificate-assets` bucket take JPEG up to 3 MB. In Canva mode
Desain exports the whole certificate for the event (ornaments, logo, number,
description, signatures) with the name and QR left empty; the admin uploads it
(the browser redraws it as a 2000×1414 JPEG), drags the Nama/QR boxes on the
preview and saves. `admin-certificates` takes `template_mode`, `template`,
`name_layout`, `qr_layout` in the same multipart save (layouts are
bounds-checked; Canva mode needs a design and both layouts) and returns a signed
`template_url`. Switching back to the system template keeps the design.
`admin-certificate-issue` then only requires the number and the design (no
Founder/PL, they are in the design). `KBCertificate.render` with `spec.template`
draws the design, the name (same shrink/two-line rule from `size`) and the QR.
The number is still typed in admin: it is what the verification page shows.
**Deploy order:** migration, `admin-certificates` + `admin-certificate-issue`,
then the site. Rollback:
`supabase/rollback/20261010010000_certificate_canva_template.down.sql`.

## Issuing certificates (sertifikat tahap 4)

Migration `20261009010000_certificates.sql` adds `certificates` (one per
registration: random `verification_code` of 20 letters/digits, snapshot of
`recipient_name`, `certificate_number`, `event_title`, `event_date`,
`event_end_at`; `pdf_path`, `issued_at`, `issued_by`, `email_sent_at`,
`email_error`) and the private bucket `certificates` (PDF, 4 MB).
Edge Function `admin-certificate-issue` (admin/super_admin):
`GET ?event=` lists confirmed registrants marked present with their certificate
state, `opens_on` / `open` (H+3 after the event's last day, WIB; `ISSUE_AFTER_DAYS`), `missing`
settings and `email_ready`; `POST ?event=&action=issue` creates the row (or
re-issues with the same code and link: new name/number snapshot);
`action=pdf&code=` stores the PDF (`%PDF-`, ≤4 MB, overwrites) and sets
`issued_at`; `action=email` sends the link through the Brevo API, with the stored PDF attached
("Sertifikat Kita Bahagia - <nama>.pdf", base64; if the download fails the email goes out link-only)
(`BREVO_API_KEY` secret, sender `CERTIFICATE_EMAIL_FROM` or
`noreply@kitabahagia.id`, reply-to `halo@`) and records the result. The email is a
card with a button (subject "<first name>, sertifikat relawanmu udah jadi!",
no Brevo tag); sending from `CERTIFICATE_EMAIL_FROM = halo@kitabahagia.id`
makes Gmail less likely to file it under Updates than `noreply@`. The PDF is
drawn in the admin's browser with `js/certificate.js` from the **saved**
settings (the page refuses while the form has unsaved changes) and wrapped as a
one-page A4 PDF (`KBCertificate.toPdf`, no library). Images for the canvas are
fetched as blobs → `ImageBitmap` so the canvas stays exportable.
Public Edge Function `public-certificate` (`GET ?k=`) returns only name,
number, event, dates, role and a 10-minute signed `pdf_url` (with `download`),
and 404 for unknown or not-yet-stored certificates. `sertifikat.html?k=`
(noindex, not in the sitemap) shows it; "Unduh PDF" asks for a fresh URL.
**Deploy order:** migration, `supabase secrets set BREVO_API_KEY=...`, the two
functions, then the site. Without the key, issuing works and the email status
says "Email belum diaktifkan"; the WA button is the fallback. Rollback: see
`supabase/rollback/20261009010000_certificates.down.sql` (breaks links already
sent).

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

## Registration emails

`supabase/functions/_shared/registration-email.ts` sends two Brevo emails (same
`BREVO_API_KEY`; sender `REGISTRATION_EMAIL_FROM`, falling back to
`CERTIFICATE_EMAIL_FROM`, then `noreply@kitabahagia.id`; reply-to `halo@`):

- **Confirmed** ("Kamu resmi terdaftar"): free first-come sign-ups from
  `create-registration`, paid sign-ups from `midtrans-webhook` on
  settlement/capture. Code, date/time, location (Maps link), WhatsApp group
  link and a Cek status button. `registrations.confirmation_email_sent_at` is
  claimed with a conditional PATCH before sending, so repeated Midtrans
  notifications never send twice; `confirmation_email_error` keeps the last
  Brevo failure (not retried automatically).
- **Applied** ("Pendaftaranmu udah masuk"): selection sign-ups, with the
  announcement date. Not recorded.

Emails run in `EdgeRuntime.waitUntil` when available and never fail the
registration or the webhook. Accepting a selection applicant in
`admin-registrations` sends the confirmed email with "Selamat, kamu lolos seleksi"
wording (same claim column, so re-accepting never sends twice; batches of 5).
Waitlist/reject send nothing (admins use the WhatsApp draft). Migration: `20261011010000`.

## Event documentation

`events.documentation_url` (https, a view-only Google Drive folder) and
`events.documentation_photos` (jsonb array, max 5 `{ url, alt }`; `admin-events` only
accepts URLs in the public `event-images` bucket) are filled in the event form's
"Dokumentasi" section. `public-events` returns both; a finished event page shows them as a
slide gallery with a Drive button, and `public-stories?slug=` embeds the related public
event's documentation for the same gallery on Kisah. `admin-certificate-issue` adds the
Drive link (and "sertifikat & foto" wording) to the certificate email when it is set.
Migration: `20261013010000`.

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

## iPaymu (second QRIS provider, Oct 2026)

Midtrans approval was still pending, so iPaymu was added next to it. Migration
`20261017010000_ipaymu_provider.sql` allows `payment_attempts.provider = 'ipaymu'` and gives
`apply_midtrans_notification` a `p_provider` argument (default `midtrans`, so the Midtrans
webhook is unchanged). The frontend, seat hold, QR drawing and `payment-status` are shared.

Function secrets:

- `PAYMENT_PROVIDER`: `midtrans` (default when unset) or `ipaymu`. Picks who makes **new**
  QRIS. Attempts already made by the other provider are still recovered while its secrets stay set.
- `IPAYMU_ENV`: `sandbox` (https://sandbox.ipaymu.com) or `production` (https://my.ipaymu.com).
- `IPAYMU_VA`, `IPAYMU_API_KEY`: from the iPaymu dashboard (Integration / API Key) of that environment.

`create-payment` calls `POST /api/v2/payment/direct` (`paymentMethod`/`paymentChannel` `qris`,
`referenceId` = our `order_id`, `expired` in whole minutes, never past `payment_deadline`,
`notifyUrl` = `ipaymu-webhook`) and stores the QRIS payload (`QrString`/`PaymentNo`).
`ipaymu-webhook` (deploy with `--no-verify-jwt`) does **not** trust the callback body: it re-reads
the transaction with `POST /api/v2/transaction` (signed with the merchant key), checks the
reference, then applies `settlement`/`expire`/`cancel` through the RPC with `p_provider = 'ipaymu'`.
Recovery of an expired pending iPaymu attempt also re-reads it, so a missed callback still confirms.

Not verified against a live iPaymu account yet (written from the public docs): the response
field holding the QRIS payload, `expiredType: "minutes"`, and which amount field
(`Amount`/`SubTotal`/`Total`) equals our price. Check the function logs on the first sandbox
transaction ("iPaymu charge rejected", "iPaymu webhook not applied").

Whitelist the site domain in the iPaymu dashboard. iPaymu reviewers test a real transaction
on the site before approving, so switch `PAYMENT_PROVIDER=ipaymu` with sandbox keys first.

## Midtrans environment

`create-payment` and `midtrans-webhook` read two function secrets:

- `MIDTRANS_ENV`: `sandbox` (https://api.sandbox.midtrans.com) or `production` (https://api.midtrans.com). Any other value makes both functions refuse to run.
- `MIDTRANS_SERVER_KEY`: the server key for that environment. A sandbox key (`SB-` prefix) is refused when `MIDTRANS_ENV=production`.

No code change or redeploy is needed to switch; secrets apply to the next request.

### Sandbox rehearsal (before production)

1. Create a paid test event (e.g. Rp10.000, capacity 2) and publish it.
2. Register on the site; the QRIS screen appears and the seat is held.
3. Copy the attempt's `qr_url` (Supabase Table Editor, `payment_attempts`, newest row)
   and paste it into the sandbox QRIS simulator
   (https://simulator.sandbox.midtrans.com/v2/qris/index), then pay.
4. Within seconds the payment screen turns "Lunas", the registration is
   `confirmed`/`paid`, and the "Kamu resmi terdaftar" email arrives once.
   If not: Edge Functions, `midtrans-webhook`, Logs.
5. Register again and let the QRIS expire: the seat is released after the
   deadline and admin shows "Kedaluwarsa".
6. Archive the test event.

### Switching to production

1. Upgrade the Supabase project to a plan with daily backups before real money flows.
2. In the Midtrans **Production** dashboard: enable QRIS/GoPay, copy the production server key, and set the Payment Notification URL above.
3. Set the secrets (both in one command so the functions never see a mixed pair):
   `npx supabase secrets set MIDTRANS_ENV=production MIDTRANS_SERVER_KEY=<production server key> --project-ref cmrdapfuqtjlmpepfwfq`
4. Make a real payment with a small-priced test event, confirm the registration becomes `confirmed`/`paid`, then refund it from the Midtrans dashboard and archive the test event.
5. Registrations and payment attempts created in sandbox stay in the database; their order IDs do not exist in production, so do not try to re-check them.

Rollback: `npx supabase secrets set MIDTRANS_ENV=sandbox MIDTRANS_SERVER_KEY=<sandbox server key> --project-ref cmrdapfuqtjlmpepfwfq`.

## Database backup

`.github/workflows/db-backup.yml` dumps schemas `public` and `auth` every Monday
02:00 WIB (and on demand via **Actions → Database backup → Run workflow**),
encrypts the dump with GPG (AES256) and keeps it as a workflow artifact for 90
days. Storage files (posters, photos, certificate PDFs) are not included.

Repository secrets (GitHub → Settings → Secrets and variables → Actions):

- `SUPABASE_DB_URL`: Supabase → Connect → **Session pooler** URI (IPv4; the
  direct `db.<ref>.supabase.co` host is IPv6-only and fails on GitHub runners),
  with the database password filled in.
- `BACKUP_PASSPHRASE`: long random passphrase. Keep a copy outside GitHub
  (password manager); without it the backups cannot be opened.

Restore (into a scratch database first, never straight over production):

```
gpg --decrypt kb-db-YYYYMMDD.dump.gpg > kb.dump
pg_restore --list kb.dump
pg_restore --no-owner --no-privileges --data-only --table=<table> -d "<target-db-url>" kb.dump
```

## Registration profile fields

Migration `20261014010000_registration_profile_fields.sql` adds `registrations.age`
(10–100), `referral_source` (`instagram`, `tiktok`, `whatsapp`, `teman`, `kampus`,
`website`, `lainnya`) and `social_account` (2–100 chars). The public form requires all
three and offers only `instagram`, `tiktok` and `teman` ("Informasi teman") as sources. `create-registration` validates them and writes them with a PATCH right after the
`create_registration` RPC succeeds (the RPC signature is unchanged); a failed PATCH is
logged and never undoes the registration. The server accepts requests without them so a
page cached before the change still works. `admin-registrations` returns them for the
Detail panel and CSV export.

Deploy order: run the migration **before** deploying `admin-registrations`, which selects
the new columns.
