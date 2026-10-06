import { sendConfirmationEmail } from "../_shared/registration-email.ts";
import { checkIpaymuTransaction, ipaymuConfig, ipaymuConfigProblems } from "../_shared/ipaymu.ts";

// iPaymu notifyUrl. The callback body is only used to learn which transaction changed:
// its state is re-read from iPaymu with the merchant's signed request before anything is
// applied, so a forged callback cannot mark a registration paid.

const inBackground = async (task: Promise<void>) => {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(task);
  else await task;
};

const response = (status: number, code: string) => new Response(
  JSON.stringify({ received: status === 200, code }),
  { status, headers: { "Content-Type": "application/json; charset=utf-8" } },
);

const readCallback = (raw: string, contentType: string) => {
  let fields: Record<string, unknown> = {};
  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) fields = parsed;
    } catch { return null; }
  } else {
    fields = Object.fromEntries(new URLSearchParams(raw));
  }
  const transactionId = String(fields.trx_id ?? "").trim();
  const referenceId = String(fields.reference_id ?? "").trim();
  if (!/^\d{1,20}$/.test(transactionId) || !/^KBPAY-[A-Z0-9-]{6,90}$/.test(referenceId)) return null;
  return { transactionId, referenceId };
};

const errorCode = (value: unknown) => {
  if (!value || typeof value !== "object") return "INTERNAL_ERROR";
  const message = (value as Record<string, unknown>).message;
  return typeof message === "string" ? message : "INTERNAL_ERROR";
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return response(405, "METHOD_NOT_ALLOWED");
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 16_384) return response(400, "INVALID_PAYLOAD");
  const raw = await request.text().catch(() => "");
  if (!raw || raw.length > 16_384) return response(400, "INVALID_PAYLOAD");
  const callback = readCallback(raw, (request.headers.get("content-type") ?? "").toLowerCase());
  if (!callback) return response(400, "INVALID_PAYLOAD");

  const url = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const config = ipaymuConfig();
  if (!url || !serviceKey || !config) {
    console.error("iPaymu webhook configuration unavailable", { missing: ipaymuConfigProblems() });
    return response(503, "UNAVAILABLE");
  }

  const transaction = await checkIpaymuTransaction(config, callback.transactionId);
  if (!transaction) return response(503, "UNAVAILABLE");
  if (transaction.referenceId !== callback.referenceId) return response(409, "INVALID_PAYMENT_STATE");
  const transactionStatus = transaction.state === "paid" ? "settlement"
    : transaction.state === "expired" ? "expire"
    : transaction.state === "cancelled" ? "cancel" : null;
  if (!transactionStatus) return response(200, "OK");

  let result: Response;
  try {
    result = await fetch(`${url}/rest/v1/rpc/apply_midtrans_notification`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}` },
      body: JSON.stringify({
        p_order_id: transaction.referenceId,
        p_provider_transaction_id: transaction.transactionId,
        p_gross_amount: transaction.amount,
        p_transaction_status: transactionStatus,
        p_fraud_status: null,
        p_provider: "ipaymu",
      }),
    });
  } catch {
    console.error("iPaymu webhook database request failed");
    return response(503, "UNAVAILABLE");
  }
  if (!result.ok) {
    const code = errorCode(await result.json().catch(() => null));
    console.error("iPaymu webhook not applied", { code, order_id: transaction.referenceId, amount: transaction.amount });
    if (code === "PAYMENT_ATTEMPT_NOT_FOUND") return response(404, "UNKNOWN_ORDER");
    if (["PAYMENT_IDENTITY_MISMATCH", "INVALID_NOTIFICATION"].includes(code)) return response(409, "INVALID_PAYMENT_STATE");
    return response(503, "PAYMENT_NOT_READY");
  }
  // Same rule as midtrans-webhook: the email helper sends once per confirmed registration.
  if (transactionStatus === "settlement") {
    await inBackground(sendConfirmationEmail(url, serviceKey, { orderId: transaction.referenceId }));
  }
  return response(200, "OK");
});
