import { checkIpaymuTransaction, ipaymuConfig, ipaymuConfigProblems, ipaymuRequest, type IpaymuConfig } from "../_shared/ipaymu.ts";

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

// MIDTRANS_ENV picks the Midtrans API. A sandbox server key (SB- prefix) is refused in
// production so a half-finished switch fails loudly instead of charging nothing.
const MIDTRANS_API_BASE: Record<string, string> = {
  sandbox: "https://api.sandbox.midtrans.com",
  production: "https://api.midtrans.com",
};
const midtransApiBase = (serverKey: string) => {
  const env = Deno.env.get("MIDTRANS_ENV") ?? "";
  const base = MIDTRANS_API_BASE[env];
  if (!base || (env === "production" && serverKey.startsWith("SB-"))) return null;
  return base;
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
// Raw QRIS payload from Midtrans, so the site can draw its own QR instead of the
// Midtrans poster image. Printable ASCII only, starting with the EMV "000201" header.
const qrStringFrom = (provider: Record<string, unknown>) =>
  typeof provider.qr_string === "string" && /^000201[\x20-\x7E]{14,1018}$/.test(provider.qr_string)
    ? provider.qr_string : null;
const storeQrString = async (url: string, key: string, attemptId: string, qrString: string) => {
  const response = await fetch(`${url}/rest/v1/payment_attempts?id=eq.${encodeURIComponent(attemptId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "apikey": key, "Authorization": `Bearer ${key}`, "Prefer": "return=minimal" },
    body: JSON.stringify({ qr_string: qrString }),
  }).catch(() => null);
  if (!response?.ok) console.error("Storing qr_string failed", { attempt_id: attemptId, status: response?.status ?? null });
};
// Missing qr_string is not an error: the site falls back to the Midtrans QR image.
const readQrString = async (url: string, key: string, attemptId: string) => {
  const response = await fetch(
    `${url}/rest/v1/payment_attempts?select=qr_string&id=eq.${encodeURIComponent(attemptId)}&limit=1`,
    { headers: { "apikey": key, "Authorization": `Bearer ${key}` } },
  ).catch(() => null);
  const rows = response?.ok ? await response.json().catch(() => null) : null;
  const value = Array.isArray(rows) ? rows[0]?.qr_string : null;
  return typeof value === "string" ? value : null;
};
const identityMatches = (provider: Record<string, unknown>, attempt: Attempt) =>
  provider.order_id === attempt.order_id && Number(provider.gross_amount) === attempt.amount;
const pendingResponse = (
  attempt: Attempt, qrUrl: string, expiresAt: string, qrString: string | null, status = 200,
) =>
  jsonResponse(status, {
    registration_code: attempt.registration_code,
    amount: attempt.amount,
    payment_status: "pending",
    qr_url: qrUrl,
    qr_string: qrString,
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

// QRIS lifetime: 60 minutes, never past the registration payment_deadline, so the
// last QRIS ends exactly at the deadline. Midtrans allows 20 seconds to 7 days for
// GoPay/Dynamic QRIS expiry (https://docs.midtrans.com/reference/gopay).
const QR_MAX_SECONDS = 60 * 60;
const QR_MIN_SECONDS = 30;
const qrSeconds = (attempt: Attempt, createdAt: Date) => {
  const deadline = parseTime(attempt.payment_deadline);
  if (!deadline) return QR_MAX_SECONDS;
  return Math.min(QR_MAX_SECONDS, Math.floor((deadline.getTime() - createdAt.getTime()) / 1000));
};

const chargeAttempt = async (attempt: Attempt, midtransKey: string, midtransBase: string) => {
  const createdAt = parseTime(attempt.created_at);
  if (!createdAt) return null;
  try {
    const response = await fetch(`${midtransBase}/v2/charge`, {
      method: "POST",
      headers: midtransHeaders(midtransKey, `charge-${attempt.attempt_id}`),
      body: JSON.stringify({
        payment_type: "qris",
        transaction_details: { order_id: attempt.order_id, gross_amount: attempt.amount },
        qris: { acquirer: "gopay" },
        item_details: [{ id: "event-registration", price: attempt.amount, quantity: 1, name: attempt.event_title.slice(0, 50) }],
        custom_expiry: { order_time: orderTime(createdAt), expiry_duration: qrSeconds(attempt, createdAt), unit: "second" },
      }),
    });
    return { response, provider: await readProvider(response) };
  } catch {
    return null;
  }
};

const resolveCharge = async (
  url: string, serviceKey: string, midtransKey: string, midtransBase: string, attempt: Attempt,
  successStatus: 200 | 201,
) => {
  const attemptCreatedAt = parseTime(attempt.created_at);
  if (attemptCreatedAt && qrSeconds(attempt, attemptCreatedAt) < QR_MIN_SECONDS) {
    await setTerminal(url, serviceKey, attempt.attempt_id, "cancelled", "payment_deadline_passed");
    return errorResponse(409, "PAYMENT_DEADLINE_PASSED");
  }
  const charged = await chargeAttempt(attempt, midtransKey, midtransBase);
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
    ?? new Date((attemptCreatedAt ?? providerCreatedAt).getTime() + qrSeconds(attempt, attemptCreatedAt ?? providerCreatedAt) * 1000)).toISOString();
  const finalized = await finalize(url, serviceKey, attempt, provider, qrUrl, expiresAt);
  if (!finalized) {
    console.error("Payment attempt finalization failed", { order_id: attempt.order_id, attempt_id: attempt.attempt_id });
    return errorResponse(500, "SERVER_ERROR");
  }
  const qrString = qrStringFrom(provider);
  if (qrString) await storeQrString(url, serviceKey, attempt.attempt_id, qrString);
  return jsonResponse(successStatus, {
    ...finalized,
    qr_string: qrString,
    payment_deadline: attempt.payment_deadline ?? null,
  });
};


// ---- iPaymu (PAYMENT_PROVIDER=ipaymu) -------------------------------------------
// Same attempt lifecycle as Midtrans: prepare -> charge -> finalize; the QRIS payload is
// drawn by the site. Paid state arrives through ipaymu-webhook (re-checked with iPaymu).
const restRows = async (url: string, key: string, path: string) => {
  const response = await fetch(`${url}/rest/v1/${path}`, { headers: { "apikey": key, "Authorization": `Bearer ${key}` } })
    .catch(() => null);
  const rows = response?.ok ? await response.json().catch(() => null) : null;
  return Array.isArray(rows) ? rows as Array<Record<string, unknown>> : null;
};
const attemptRow = async (url: string, key: string, attemptId: string) =>
  (await restRows(url, key, `payment_attempts?select=provider,provider_transaction_id&id=eq.${encodeURIComponent(attemptId)}&limit=1`))?.[0] ?? null;
const stampIpaymu = async (url: string, key: string, attemptId: string) => {
  const response = await fetch(
    `${url}/rest/v1/payment_attempts?id=eq.${encodeURIComponent(attemptId)}&status=eq.creating`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "apikey": key, "Authorization": `Bearer ${key}`, "Prefer": "return=minimal" },
      body: JSON.stringify({ provider: "ipaymu" }),
    },
  ).catch(() => null);
  return Boolean(response?.ok);
};
const applyIpaymuPaid = async (url: string, key: string, orderId: string, transactionId: string, amount: number) => {
  const result = await rpc(url, key, "apply_midtrans_notification", {
    p_order_id: orderId, p_provider_transaction_id: transactionId, p_gross_amount: amount,
    p_transaction_status: "settlement", p_fraud_status: null, p_provider: "ipaymu",
  }).catch(() => null);
  return Boolean(result?.response.ok);
};
// The field name of the QRIS payload is not documented clearly, so any EMV QRIS string
// (starts with "000201") in the response is used, preferring the likely names first.
const isQrisPayload = (value: unknown): value is string =>
  typeof value === "string" && /^000201[\x20-\x7E]{14,1018}$/.test(value.trim());
const ipaymuQrString = (data: Record<string, unknown>) => {
  for (const field of ["QrString", "QrisString", "QRString", "PaymentNo"]) {
    if (isQrisPayload(data[field])) return (data[field] as string).trim();
  }
  const seen = new Set<unknown>();
  const search = (value: unknown, depth: number): string | null => {
    if (isQrisPayload(value)) return value.trim();
    if (!value || typeof value !== "object" || depth > 3 || seen.has(value)) return null;
    seen.add(value);
    for (const item of Object.values(value as Record<string, unknown>)) {
      const found = search(item, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return search(data, 0);
};

const resolveIpaymuCharge = async (
  url: string, serviceKey: string, config: IpaymuConfig, attempt: Attempt, input: PaymentRequest,
  successStatus: 200 | 201,
) => {
  const createdAt = parseTime(attempt.created_at);
  if (!createdAt) return errorResponse(500, "SERVER_ERROR");
  // iPaymu counts expiry in whole minutes, so round down to stay inside payment_deadline.
  const minutes = Math.floor(qrSeconds(attempt, createdAt) / 60);
  if (minutes < 1) {
    await setTerminal(url, serviceKey, attempt.attempt_id, "cancelled", "payment_deadline_passed");
    return errorResponse(409, "PAYMENT_DEADLINE_PASSED");
  }
  if (!await stampIpaymu(url, serviceKey, attempt.attempt_id)) return errorResponse(500, "SERVER_ERROR");
  const registration = (await restRows(url, serviceKey,
    `registrations?select=name,phone&registration_code=eq.${encodeURIComponent(attempt.registration_code)}&limit=1`))?.[0];
  if (!registration) return errorResponse(500, "SERVER_ERROR");

  const charged = await ipaymuRequest(config, "/api/v2/payment/direct", {
    name: String(registration.name ?? "").slice(0, 100),
    phone: String(registration.phone ?? "").slice(0, 20),
    email: input.email,
    amount: attempt.amount,
    notifyUrl: `${url}/functions/v1/ipaymu-webhook`,
    expired: minutes,
    expiredType: "minutes",
    comments: attempt.event_title.slice(0, 100),
    referenceId: attempt.order_id,
    paymentMethod: "qris",
    paymentChannel: "qris",
  }).catch(() => null);
  if (!charged) return errorResponse(409, "PAYMENT_IN_PROGRESS");
  const data = charged.data;
  const transactionId = data?.TransactionId !== undefined && data?.TransactionId !== null ? String(data.TransactionId) : "";
  const qrString = data ? ipaymuQrString(data) : null;
  if (!charged.ok || !data || !transactionId || !qrString) {
    const definitive = charged.response.status >= 400 && charged.response.status < 500 || (charged.ok && !transactionId);
    console.error("iPaymu charge rejected", {
      order_id: attempt.order_id, http_status: charged.response.status,
      status: charged.json?.Status ?? null, message: charged.json?.Message ?? null,
      has_transaction_id: Boolean(transactionId), has_qr_string: Boolean(qrString),
      // Names and value types only (no values), to find the QRIS field if it moves again.
      data_fields: data ? Object.entries(data).map(([key, value]) =>
        `${key}:${value === null ? "null" : Array.isArray(value) ? "array" : typeof value}`) : null,
    });
    if (definitive) await setTerminal(url, serviceKey, attempt.attempt_id, "failed", `ipaymu_${charged.response.status}`);
    return errorResponse(definitive ? 502 : 409, definitive ? "PAYMENT_PROVIDER_ERROR" : "PAYMENT_IN_PROGRESS");
  }
  const ownExpiry = new Date(createdAt.getTime() + minutes * 60 * 1000);
  const providerExpiry = parseTime(data.Expired);
  const expiresAt = (providerExpiry && providerExpiry < ownExpiry ? providerExpiry : ownExpiry).toISOString();
  // qr_url is the fallback image; the site draws qr_string, so a non-https value is replaced.
  const qrUrl = typeof data.QrImage === "string" && /^https:\/\//.test(data.QrImage)
    ? data.QrImage : `${config.base}/payment/${encodeURIComponent(transactionId)}`;
  const finalized = await finalize(url, serviceKey, attempt, { transaction_id: transactionId }, qrUrl, expiresAt);
  if (!finalized) {
    console.error("Payment attempt finalization failed", { order_id: attempt.order_id, attempt_id: attempt.attempt_id });
    return errorResponse(500, "SERVER_ERROR");
  }
  await storeQrString(url, serviceKey, attempt.attempt_id, qrString);
  return jsonResponse(successStatus, { ...finalized, qr_string: qrString, payment_deadline: attempt.payment_deadline ?? null });
};

// A stale 'creating' attempt never showed a QR, so it is cancelled and replaced. A pending
// one past its expiry is re-read from iPaymu first, so a missed callback still confirms it.
const recoverIpaymu = async (
  url: string, serviceKey: string, config: IpaymuConfig, attempt: Attempt, input: PaymentRequest,
): Promise<Attempt | Response> => {
  if (attempt.local_status === "creating") {
    if (!await setTerminal(url, serviceKey, attempt.attempt_id, "cancelled", "ipaymu_create_unconfirmed")) {
      return errorResponse(500, "SERVER_ERROR");
    }
    return await prepare(url, serviceKey, input);
  }
  const row = await attemptRow(url, serviceKey, attempt.attempt_id);
  const transactionId = typeof row?.provider_transaction_id === "string" ? row.provider_transaction_id : "";
  if (transactionId) {
    const transaction = await checkIpaymuTransaction(config, transactionId);
    if (!transaction) return errorResponse(409, "PAYMENT_IN_PROGRESS");
    if (transaction.state === "paid") {
      if (transaction.referenceId === attempt.order_id) {
        await applyIpaymuPaid(url, serviceKey, attempt.order_id, transactionId, transaction.amount);
      }
      return errorResponse(409, "PAYMENT_AWAITING_CONFIRMATION");
    }
  }
  if (!await setTerminal(url, serviceKey, attempt.attempt_id, "expired", "ipaymu_expired")) {
    return errorResponse(500, "SERVER_ERROR");
  }
  return await prepare(url, serviceKey, input);
};

// ---- Midtrans recovery (unchanged behaviour, moved into a function) ---------------
const recoverMidtrans = async (
  url: string, serviceKey: string, midtransKey: string, midtransBase: string,
  attempt: Attempt, input: PaymentRequest,
): Promise<Attempt | Response> => {
  let response: Response;
  let provider: Record<string, unknown> | null;
  try {
    response = await fetch(
      `${midtransBase}/v2/${encodeURIComponent(attempt.order_id)}/status`,
      { method: "GET", headers: midtransHeaders(midtransKey) },
    );
    provider = await readProvider(response);
  } catch {
    return errorResponse(409, "PAYMENT_IN_PROGRESS");
  }

  const notFound = response.status === 404 || provider?.status_code === "404";
  if (notFound) {
    return attempt.local_status === "creating"
      ? await resolveCharge(url, serviceKey, midtransKey, midtransBase, attempt, 200)
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
      return await prepare(url, serviceKey, input);
    } else if (status === "pending") {
      const expiry = parseTime(provider.expiry_time) ?? parseTime(attempt.expires_at);
      if (!expiry) return errorResponse(409, "PAYMENT_IN_PROGRESS");
      if (expiry > new Date()) {
        if (attempt.local_status === "creating") {
          return await resolveCharge(url, serviceKey, midtransKey, midtransBase, attempt, 200);
        }
        return attempt.qr_url
          ? pendingResponse(
            attempt, attempt.qr_url, expiry.toISOString(), await readQrString(url, serviceKey, attempt.attempt_id),
          )
          : errorResponse(409, "PAYMENT_IN_PROGRESS");
      }

      let expireResponse: Response;
      let expiredProvider: Record<string, unknown> | null;
      try {
        expireResponse = await fetch(
          `${midtransBase}/v2/${encodeURIComponent(attempt.order_id)}/expire`,
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
      return await prepare(url, serviceKey, input);
    } else {
      return errorResponse(409, "PAYMENT_IN_PROGRESS");
    }
  }
  return errorResponse(409, "PAYMENT_IN_PROGRESS");
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

  // PAYMENT_PROVIDER picks who makes new QRIS (default midtrans). Attempts already made by
  // the other provider are still recovered with that provider while its secrets are set.
  const url = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const provider = (Deno.env.get("PAYMENT_PROVIDER") ?? "midtrans").trim().toLowerCase();
  const midtransKey = Deno.env.get("MIDTRANS_SERVER_KEY");
  const midtransBase = midtransKey ? midtransApiBase(midtransKey) : null;
  const ipaymu = ipaymuConfig();
  const ready = provider === "ipaymu" ? Boolean(ipaymu) : provider === "midtrans" && Boolean(midtransKey && midtransBase);
  if (!url || !serviceKey || !ready) {
    console.error("Missing or invalid server payment configuration", {
      payment_provider: provider,
      missing: provider === "ipaymu" ? ipaymuConfigProblems()
        : provider === "midtrans" ? ["MIDTRANS_ENV/MIDTRANS_SERVER_KEY"] : ["PAYMENT_PROVIDER (midtrans/ipaymu)"],
    });
    return errorResponse(500, "SERVER_ERROR");
  }

  const prepared = await prepare(url, serviceKey, input);
  if (prepared instanceof Response) return prepared;
  let attempt = prepared;
  if (attempt.is_reused) {
    return attempt.qr_url && attempt.expires_at
      ? pendingResponse(
        attempt, attempt.qr_url, attempt.expires_at, await readQrString(url, serviceKey, attempt.attempt_id),
      )
      : errorResponse(500, "SERVER_ERROR");
  }

  if (attempt.needs_recovery) {
    const attemptProvider = (await attemptRow(url, serviceKey, attempt.attempt_id))?.provider;
    let recovered: Attempt | Response;
    if (attemptProvider === "ipaymu") {
      if (!ipaymu) return errorResponse(409, "PAYMENT_IN_PROGRESS");
      recovered = await recoverIpaymu(url, serviceKey, ipaymu, attempt, input);
    } else if (attempt.local_status === "creating" && provider === "ipaymu") {
      // A Midtrans attempt that never got a QR is simply replaced by an iPaymu one.
      recovered = await setTerminal(url, serviceKey, attempt.attempt_id, "cancelled", "provider_switched")
        ? await prepare(url, serviceKey, input) : errorResponse(500, "SERVER_ERROR");
    } else {
      if (!midtransKey || !midtransBase) return errorResponse(409, "PAYMENT_IN_PROGRESS");
      recovered = await recoverMidtrans(url, serviceKey, midtransKey, midtransBase, attempt, input);
    }
    if (recovered instanceof Response) return recovered;
    attempt = recovered;
  }

  if (attempt.needs_recovery || attempt.is_reused) return errorResponse(409, "PAYMENT_IN_PROGRESS");
  return provider === "ipaymu" && ipaymu
    ? await resolveIpaymuCharge(url, serviceKey, ipaymu, attempt, input, 201)
    : await resolveCharge(url, serviceKey, midtransKey!, midtransBase!, attempt, 201);
});
