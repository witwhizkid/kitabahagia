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

Free events are confirmed with `not_required`; paid events become `pending_payment` with `unpaid`. Amount and statuses always come from the database. Payment is not implemented.

## Local and deployment commands

The function requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in its server environment.

```sh
supabase db reset
supabase functions serve create-registration --no-verify-jwt
supabase functions deploy create-registration --no-verify-jwt
supabase db push
```

`--no-verify-jwt` allows registration without Supabase Auth; validation and database access remain server-side. Frontend integration is not implemented, and frontend event data may be demo data rather than authoritative database records.
