const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const jsonResponse = (status: number, body: Record<string, unknown>) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } },
);
const messages: Record<string, string> = {
  INVALID_REQUEST: "Data pembayaran tidak valid.",
  REGISTRATION_NOT_FOUND: "Pendaftaran tidak ditemukan.",
  REGISTRATION_MISMATCH: "Pendaftaran tidak ditemukan.",
  PAYMENT_NOT_REQUIRED: "Pendaftaran ini tidak memerlukan pembayaran.",
  PAYMENT_ALREADY_PAID: "Pembayaran untuk pendaftaran ini sudah selesai.",
  PAYMENT_NOT_ELIGIBLE: "Pendaftaran ini belum dapat diproses untuk pembayaran.",
  PAYMENT_IN_PROGRESS: "Pembayaran sedang diproses. Silakan coba lagi sebentar.",
  PAYMENT_AWAITING_CONFIRMATION: "Pembayaran sedang menunggu konfirmasi.",
  PAYMENT_DEADLINE_PASSED: "Batas waktu pembayaran sudah lewat. Pendaftaran ini tidak lagi menahan kuota.",
  PAYMENT_PROVIDER_ERROR: "Layanan pembayaran sedang bermasalah. Silakan coba lagi.",
  SERVER_ERROR: "Terjadi kesalahan pada server.",
};
const errorResponse = (status: number, code: string) =>
  jsonResponse(status, { success: false, error: { code, message: messages[code] } });
const conflictErrors = new Set([
  "PAYMENT_NOT_REQUIRED", "PAYMENT_ALREADY_PAID", "PAYMENT_NOT_ELIGIBLE",
  "PAYMENT_IN_PROGRESS", "PAYMENT_AWAITING_CONFIRMATION", "PAYMENT_DEADLINE_PASSED",
]);

type PaymentRequest = { registration_code: string; email: string };
type Attempt = {
  is_reused?: boolean;
  needs_recovery?: boolean;
  attempt_id: string;
  order_id: string;
  amount: number;
  created_at: string;
  registration_code: string;
  event_title: string;
  local_status?: "creating" | "pending";
  qr_url?: string;
  expires_at?: string;
  payment_deadline?: string | null;
};

const validateRequest = (value: unknown): PaymentRequest | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !["registration_code", "email"].includes(key))) return null;
  if (typeof body.registration_code !== "string" || typeof body.email !== "string") return null;
  const registrationCode = body.registration_code.trim().toUpperCase();
  const email = body.email.trim().toLowerCase();
  if (!/^KB-[A-Z0-9-]{6,40}$/.test(registrationCode)
    || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return { registration_code: registrationCode, email };
};

const rpc = async (url: string, key: string, name: string, body: Record<string, unknown>) => {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": key, "Authorization": `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null) as Record<string, unknown> | boolean | null;
  return { response, result };
};

const parseTime = (value: unknown): Date | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value.trim())
    ? value.trim() : `${value.trim().replace(" ", "T")}+07:00`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
};

const orderTime = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date).reduce<Record<string, string>>((all, part) => {
    if (part.type !== "literal") all[part.type] = part.value;
    return all;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} +0700`;
};

const midtransHeaders = (key: string, idempotencyKey?: string) => ({
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": `Basic ${btoa(`${key}:`)}`,
  ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
});
const readProvider = async (response: Response) =>
  await response.json().catch(() => null) as Record<string, unknown> | null;
const qrFrom = (provider: Record<string, unknown>) => {
  const actions = Array.isArray(provider.actions) ? provider.actions as Array<Record<string, unknown>> : [];
  const action = actions.find((item) => item.name === "generate-qr-code-v2")
    ?? actions.find((item) => item.name === "generate-qr-code");
  return typeof action?.url === "string" && /^https:\/\//.test(action.url) ? action.url : null;
};
const identityMatches = (provider: Record<string, unknown>, attempt: Attempt) =>
  provider.order_id === attempt.order_id && Number(provider.gross_amount) === attempt.amount;
const pendingResponse = (attempt: Attempt, qrUrl: string, expiresAt: string, status = 200) =>
  jsonResponse(status, {
    registration_code: attempt.registration_code,
    amount: attempt.amount,
    payment_status: "pending",
    qr_url: qrUrl,
    expires_at: expiresAt,
    payment_deadline: attempt.payment_deadline ?? null,
    order_id: attempt.order_id,
  });

const prepare = async (url: string, key: string, input: PaymentRequest): Promise<Attempt | Response> => {
  const prepared = await rpc(url, key, "prepare_payment_attempt", {
    p_registration_code: input.registration_code,
    p_email: input.email,
  }).catch(() => null);
  if (!prepared) return errorResponse(500, "SERVER_ERROR");
  if (!prepared.response.ok || !prepared.result || typeof prepared.result !== "object") {
    const code = typeof (prepared?.result as Record<string, unknown> | null)?.message === "string"
      ? String((prepared.result as Record<string, unknown>).message) : "SERVER_ERROR";
    const status = ["REGISTRATION_NOT_FOUND", "REGISTRATION_MISMATCH"].includes(code)
      ? 404 : conflictErrors.has(code) ? 409 : 500;
    return errorResponse(status, code in messages ? code : "SERVER_ERROR");
  }
  const attempt = prepared.result as unknown as Attempt;
  if (!attempt.attempt_id || !attempt.order_id || !attempt.created_at || !parseTime(attempt.created_at)
    || !Number.isInteger(attempt.amount)
    || attempt.amount <= 0 || !attempt.registration_code || !attempt.event_title) {
    return errorResponse(500, "SERVER_ERROR");
  }
  return attempt;
};

const setTerminal = async (
  url: string, key: string, attemptId: string,
  status: "failed" | "expired" | "cancelled", providerStatus: string,
) => {
  const result = await rpc(url, key, "set_payment_attempt_terminal", {
    p_attempt_id: attemptId, p_status: status, p_provider_status: providerStatus.slice(0, 100),
  }).catch(() => null);
  return Boolean(result?.response.ok && result.result === true);
};

const finalize = async (
  url: string, key: string, attempt: Attempt, provider: Record<string, unknown>,
  qrUrl: string, expiresAt: string,
) => {
  const transactionId = typeof provider.transaction_id === "string" ? provider.transaction_id : "";
  if (!transactionId) return null;
  const result = await rpc(url, key, "finalize_payment_attempt", {
    p_attempt_id: attempt.attempt_id,
    p_provider_transaction_id: transactionId,
    p_provider_status: "pending",
    p_qr_url: qrUrl,
    p_expires_at: expiresAt,
  }).catch(() => null);
  return result?.response.ok && result.result && typeof result.result === "object" ? result.result : null;
};

// QRIS lifetime: 60 minutes, never past the registration payment_deadline.
// Midtrans allows 20 seconds to 7 days for GoPay/Dynamic QRIS expiry
// (https://docs.midtrans.com/reference/gopay).
const QR_MAX_MINUTES = 60;
const qrMinutes = (attempt: Attempt, createdAt: Date) => {
  const deadline = parseTime(attempt.payment_deadline);
  if (!deadline) return QR_MAX_MINUTES;
  return Math.min(QR_MAX_MINUTES, Math.floor((deadline.getTime() - createdAt.getTime()) / 60000));
};

const chargeAttempt = async (attempt: Attempt, midtransKey: string) => {
  const createdAt = parseTime(attempt.created_at);
  if (!createdAt) return null;
  try {
    const response = await fetch("https://api.sandbox.midtrans.com/v2/charge", {
      method: "POST",
      headers: midtransHeaders(midtransKey, `charge-${attempt.attempt_id}`),
      body: JSON.stringify({
        payment_type: "qris",
        transaction_details: { order_id: attempt.order_id, gross_amount: attempt.amount },
        qris: { acquirer: "gopay" },
        item_details: [{ id: "event-registration", price: attempt.amount, quantity: 1, name: attempt.event_title.slice(0, 50) }],
        custom_expiry: { order_time: orderTime(createdAt), expiry_duration: qrMinutes(attempt, createdAt), unit: "minute" },
      }),
    });
    return { response, provider: await readProvider(response) };
  } catch {
    return null;
  }
};

const resolveCharge = async (
  url: string, serviceKey: string, midtransKey: string, attempt: Attempt,
  successStatus: 200 | 201,
) => {
  const attemptCreatedAt = parseTime(attempt.created_at);
  if (attemptCreatedAt && qrMinutes(attempt, attemptCreatedAt) < 1) {
    await setTerminal(url, serviceKey, attempt.attempt_id, "cancelled", "payment_deadline_passed");
    return errorResponse(409, "PAYMENT_DEADLINE_PASSED");
  }
  const charged = await chargeAttempt(attempt, midtransKey);
  if (!charged) return errorResponse(409, "PAYMENT_IN_PROGRESS");
  const { response, provider } = charged;
  if (response.status === 202) return errorResponse(409, "PAYMENT_IN_PROGRESS");
  if (!response.ok || !provider) {
    const providerStatus = typeof provider?.transaction_status === "string" ? provider.transaction_status : "";
    const definitive = [400, 401, 402, 403].includes(response.status) && !provider?.transaction_id;
    if (definitive) {
      await setTerminal(url, serviceKey, attempt.attempt_id, "failed", providerStatus || `http_${response.status}`);
    }
    console.error("Midtrans charge rejected", { order_id: attempt.order_id, status: response.status });
    return errorResponse(definitive ? 502 : 409, definitive ? "PAYMENT_PROVIDER_ERROR" : "PAYMENT_IN_PROGRESS");
  }
  const providerStatus = typeof provider.transaction_status === "string" ? provider.transaction_status : "";
  if (["settlement", "capture"].includes(providerStatus)) {
    return errorResponse(409, "PAYMENT_AWAITING_CONFIRMATION");
  }
  const qrUrl = qrFrom(provider);
  if (typeof provider.transaction_id !== "string" || providerStatus !== "pending"
    || !identityMatches(provider, attempt) || !qrUrl) {
    console.error("Midtrans response requires reconciliation", {
      order_id: attempt.order_id,
      provider_status: providerStatus || "unknown",
      http_status: response.status,
      status_code: provider?.status_code ?? null,
      status_message: provider?.status_message ?? null,
      transaction_status: provider?.transaction_status ?? null,
      returned_order_id: provider?.order_id ?? null,
      has_transaction_id: typeof provider?.transaction_id === "string",
      has_actions: Array.isArray(provider?.actions),
    });
    return errorResponse(409, "PAYMENT_IN_PROGRESS");
  }
  const providerCreatedAt = parseTime(provider.transaction_time) ?? parseTime(attempt.created_at);
  if (!providerCreatedAt) return errorResponse(409, "PAYMENT_IN_PROGRESS");
  const expiresAt = (parseTime(provider.expiry_time)
    ?? new Date(providerCreatedAt.getTime() + qrMinutes(attempt, providerCreatedAt) * 60000)).toISOString();
  const finalized = await finalize(url, serviceKey, attempt, provider, qrUrl, expiresAt);
  if (!finalized) {
    console.error("Payment attempt finalization failed", { order_id: attempt.order_id, attempt_id: attempt.attempt_id });
    return errorResponse(500, "SERVER_ERROR");
  }
  return jsonResponse(successStatus, { ...finalized, payment_deadline: attempt.payment_deadline ?? null });
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return errorResponse(405, "INVALID_REQUEST");
  if (!(request.headers.get("content-type")?.toLowerCase() ?? "").includes("application/json")) {
    return errorResponse(400, "INVALID_REQUEST");
  }
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse(400, "INVALID_REQUEST"); }
  const input = validateRequest(body);
  if (!input) return errorResponse(400, "INVALID_REQUEST");

  const url = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const midtransKey = Deno.env.get("MIDTRANS_SERVER_KEY");
  if (!url || !serviceKey || !midtransKey || Deno.env.get("MIDTRANS_ENV") !== "sandbox") {
    console.error("Missing or invalid server payment configuration");
    return errorResponse(500, "SERVER_ERROR");
  }

  let prepared = await prepare(url, serviceKey, input);
  if (prepared instanceof Response) return prepared;
  let attempt = prepared;
  if (attempt.is_reused) {
    return attempt.qr_url && attempt.expires_at
      ? pendingResponse(attempt, attempt.qr_url, attempt.expires_at)
      : errorResponse(500, "SERVER_ERROR");
  }

  if (attempt.needs_recovery) {
    let response: Response;
    let provider: Record<string, unknown> | null;
    try {
      response = await fetch(
        `https://api.sandbox.midtrans.com/v2/${encodeURIComponent(attempt.order_id)}/status`,
        { method: "GET", headers: midtransHeaders(midtransKey) },
      );
      provider = await readProvider(response);
    } catch {
      return errorResponse(409, "PAYMENT_IN_PROGRESS");
    }

    const notFound = response.status === 404 || provider?.status_code === "404";
    if (notFound) {
      return attempt.local_status === "creating"
        ? await resolveCharge(url, serviceKey, midtransKey, attempt, 200)
        : errorResponse(409, "PAYMENT_IN_PROGRESS");
    } else {
      if (!response.ok || !provider) return errorResponse(502, "PAYMENT_PROVIDER_ERROR");
      if (!identityMatches(provider, attempt) || typeof provider.transaction_status !== "string") {
        return errorResponse(502, "PAYMENT_PROVIDER_ERROR");
      }
      const status = provider.transaction_status;
      if (["settlement", "capture"].includes(status)) {
        return errorResponse(409, "PAYMENT_AWAITING_CONFIRMATION");
      }
      if (["expire", "cancel", "deny"].includes(status)) {
        const terminal = status === "expire" ? "expired" : status === "cancel" ? "cancelled" : "failed";
        if (!await setTerminal(url, serviceKey, attempt.attempt_id, terminal, status)) {
          return errorResponse(500, "SERVER_ERROR");
        }
        prepared = await prepare(url, serviceKey, input);
        if (prepared instanceof Response) return prepared;
        attempt = prepared;
      } else if (status === "pending") {
        const expiry = parseTime(provider.expiry_time) ?? parseTime(attempt.expires_at);
        if (!expiry) return errorResponse(409, "PAYMENT_IN_PROGRESS");
        if (expiry > new Date()) {
          if (attempt.local_status === "creating") {
            return await resolveCharge(url, serviceKey, midtransKey, attempt, 200);
          }
          return attempt.qr_url
            ? pendingResponse(attempt, attempt.qr_url, expiry.toISOString())
            : errorResponse(409, "PAYMENT_IN_PROGRESS");
        }

        let expireResponse: Response;
        let expiredProvider: Record<string, unknown> | null;
        try {
          expireResponse = await fetch(
            `https://api.sandbox.midtrans.com/v2/${encodeURIComponent(attempt.order_id)}/expire`,
            { method: "POST", headers: midtransHeaders(midtransKey, `expire-${attempt.attempt_id}`) },
          );
          expiredProvider = await readProvider(expireResponse);
        } catch {
          return errorResponse(409, "PAYMENT_IN_PROGRESS");
        }
        if (!expireResponse.ok || !expiredProvider || !identityMatches(expiredProvider, attempt)) {
          return errorResponse(409, "PAYMENT_IN_PROGRESS");
        }
        if (["settlement", "capture"].includes(String(expiredProvider.transaction_status))) {
          return errorResponse(409, "PAYMENT_AWAITING_CONFIRMATION");
        }
        if (expiredProvider.transaction_status !== "expire") return errorResponse(409, "PAYMENT_IN_PROGRESS");
        if (!await setTerminal(url, serviceKey, attempt.attempt_id, "expired", "expire")) {
          return errorResponse(500, "SERVER_ERROR");
        }
        prepared = await prepare(url, serviceKey, input);
        if (prepared instanceof Response) return prepared;
        attempt = prepared;
      } else {
        return errorResponse(409, "PAYMENT_IN_PROGRESS");
      }
    }
  }

  if (attempt.needs_recovery || attempt.is_reused) return errorResponse(409, "PAYMENT_IN_PROGRESS");
  return await resolveCharge(url, serviceKey, midtransKey, attempt, 201);
});
