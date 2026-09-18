# Supabase backend

## Data and security

- `public.events` stores authoritative event availability, price, capacity, and deadlines.
- `public.registrations` stores participant data and server-derived registration/payment state.
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

## Local and deployment commands

The function requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in its server environment.

```sh
supabase db reset
supabase functions serve create-registration --no-verify-jwt
supabase functions deploy create-registration --no-verify-jwt
supabase db push
```

`--no-verify-jwt` allows registration without Supabase Auth; validation and database access remain server-side. Frontend integration is not implemented, and frontend event data may be demo data rather than authoritative database records.

## Midtrans Sandbox webhook

Set the Payment Notification URL in the Midtrans Sandbox dashboard to:

`https://cmrdapfuqtjlmpepfwfq.supabase.co/functions/v1/midtrans-webhook`

The webhook accepts POST JSON notifications, checks Midtrans SHA-512 signatures with the server-only `MIDTRANS_SERVER_KEY`, and applies payment state through the service-role-only `apply_midtrans_notification` RPC. It rejects unknown orders, identity/amount mismatches, and stale status downgrades. Configure `MIDTRANS_ENV=sandbox` and `MIDTRANS_SERVER_KEY` as Supabase function secrets. Test with a new Sandbox payment and the Midtrans simulator; do not mark payment paid from the browser or by editing database rows.
