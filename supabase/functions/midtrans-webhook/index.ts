type Notification = {
  order_id: string;
  status_code: string;
  gross_amount: string;
  signature_key: string;
  transaction_status: string;
  transaction_id: string;
  fraud_status: string | null;
};

const response = (status: number, code: string) => new Response(
  JSON.stringify({ received: status === 200, code }),
  { status, headers: { "Content-Type": "application/json; charset=utf-8" } },
);

const statuses = new Set([
  "pending", "settlement", "capture", "expire", "deny", "cancel",
  "refund", "partial_refund",
]);

const parseNotification = (value: unknown): Notification | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const required = [
    "order_id", "status_code", "gross_amount", "signature_key",
    "transaction_status", "transaction_id",
  ];
  if (required.some((key) => typeof body[key] !== "string")) return null;
  const input = body as Notification;
  if (!input.order_id || input.order_id.length > 100
    || !/^\d{3}$/.test(input.status_code)
    || !/^\d+(?:\.\d{1,2})?$/.test(input.gross_amount)
    || !Number.isSafeInteger(Number(input.gross_amount))
    || Number(input.gross_amount) <= 0
    || !/^[a-fA-F0-9]{128}$/.test(input.signature_key)
    || !statuses.has(input.transaction_status)
    || !input.transaction_id || input.transaction_id.length > 100
    || (body.fraud_status !== undefined && body.fraud_status !== null
      && typeof body.fraud_status !== "string")) return null;
  input.fraud_status = typeof body.fraud_status === "string" ? body.fraud_status : null;
  return input;
};

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const validSignature = async (input: Notification, serverKey: string) => {
  const source = input.order_id + input.status_code + input.gross_amount + serverKey;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-512", new TextEncoder().encode(source)));
  const expected = toHex(digest);
  const supplied = input.signature_key.toLowerCase();
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return mismatch === 0;
};

const errorCode = (value: unknown) => {
  if (!value || typeof value !== "object") return "INTERNAL_ERROR";
  const message = (value as Record<string, unknown>).message;
  return typeof message === "string" ? message : "INTERNAL_ERROR";
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return response(405, "METHOD_NOT_ALLOWED");
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return response(400, "INVALID_PAYLOAD");
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 16_384) return response(400, "INVALID_PAYLOAD");
  const raw = await request.text().catch(() => "");
  if (!raw || raw.length > 16_384) return response(400, "INVALID_PAYLOAD");
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return response(400, "INVALID_PAYLOAD"); }
  const input = parseNotification(body);
  if (!input) return response(400, "INVALID_PAYLOAD");

  const url = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const serverKey = Deno.env.get("MIDTRANS_SERVER_KEY");
  if (!url || !serviceKey || !serverKey || Deno.env.get("MIDTRANS_ENV") !== "sandbox") {
    console.error("Webhook payment configuration unavailable");
    return response(503, "UNAVAILABLE");
  }

  if (!await validSignature(input, serverKey)) return response(401, "INVALID_SIGNATURE");
  if (["settlement", "capture"].includes(input.transaction_status)
    && (input.status_code !== "200"
      || (input.fraud_status !== null && input.fraud_status !== "accept"))) {
    return response(400, "INCONSISTENT_STATUS");
  }

  let result: Response;
  try {
    result = await fetch(`${url}/rest/v1/rpc/apply_midtrans_notification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        p_order_id: input.order_id,
        p_provider_transaction_id: input.transaction_id,
        p_gross_amount: input.gross_amount,
        p_transaction_status: input.transaction_status,
        p_fraud_status: input.fraud_status,
      }),
    });
  } catch {
    console.error("Webhook database request failed");
    return response(503, "UNAVAILABLE");
  }
  if (!result.ok) {
    const code = errorCode(await result.json().catch(() => null));
    if (code === "PAYMENT_ATTEMPT_NOT_FOUND") return response(404, "UNKNOWN_ORDER");
    if (["PAYMENT_IDENTITY_MISMATCH", "INVALID_NOTIFICATION", "PAYMENT_FRAUD_NOT_ACCEPTED"].includes(code)) {
      return response(409, "INVALID_PAYMENT_STATE");
    }
    if (["PAYMENT_NOT_READY", "REGISTRATION_NOT_ELIGIBLE"].includes(code)) {
      return response(503, "PAYMENT_NOT_READY");
    }
    console.error("Webhook database update failed", { status: result.status });
    return response(503, "UNAVAILABLE");
  }
  return response(200, "OK");
});
