// Manual QRIS (PAYMENT_PROVIDER=manual): the registrant uploads a payment proof
// (multipart: registration_code, email, proof). The image goes to the private
// payment-proofs bucket; submit_payment_proof confirms the registration right away and
// the confirmation email goes out. An admin checks the proof later in admin-registrations
// ("Bukti belum dicek" -> Valid / Batalkan).
import { sendConfirmationEmail } from "../_shared/registration-email.ts";

const inBackground = async (task: Promise<void>) => {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(task);
  else await task;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const MAX_PROOF_BYTES = 2 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_PROOF_BYTES + 16 * 1024;
const BUCKET = "payment-proofs";

const messages: Record<string, string> = {
  INVALID_REQUEST: "Data tidak valid.",
  INVALID_PROOF: "Unggah bukti pembayaran dalam format JPG, PNG, atau WebP dengan ukuran maksimal 2 MB.",
  REGISTRATION_NOT_FOUND: "Pendaftaran tidak ditemukan.",
  PAYMENT_ALREADY_PAID: "Bukti pembayaran untuk pendaftaran ini sudah diterima.",
  PAYMENT_NOT_ELIGIBLE: "Pendaftaran ini belum dapat menerima bukti pembayaran.",
  PAYMENT_DEADLINE_PASSED: "Batas waktu pembayaran sudah lewat. Hubungi admin dengan kode pendaftaranmu.",
  SERVER_ERROR: "Bukti belum dapat diunggah. Coba lagi sebentar.",
};
const jsonResponse = (status: number, body: Record<string, unknown>) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } },
);
const errorResponse = (status: number, code: string) =>
  jsonResponse(status, { success: false, error: { code, message: messages[code] ?? messages.SERVER_ERROR } });

const imageType = (bytes: Uint8Array, type: string) => {
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const webp = bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
  if (type === "image/jpeg" && jpeg) return "jpg";
  if (type === "image/png" && png) return "png";
  if (type === "image/webp" && webp) return "webp";
  return null;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return errorResponse(405, "INVALID_REQUEST");
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) return errorResponse(400, "INVALID_REQUEST");
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return errorResponse(413, "INVALID_PROOF");

  const url = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return errorResponse(500, "SERVER_ERROR");

  let form: FormData;
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > MAX_BODY_BYTES) return errorResponse(413, "INVALID_PROOF");
    form = await new Request(request.url, { method: "POST", headers: { "content-type": contentType }, body: bytes }).formData();
  } catch {
    return errorResponse(400, "INVALID_REQUEST");
  }
  const code = String(form.get("registration_code") ?? "").trim().toUpperCase();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const file = form.get("proof");
  if (!/^KB-[A-Z0-9-]{6,40}$/.test(code) || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return errorResponse(400, "INVALID_REQUEST");
  }
  if (!(file instanceof File) || file.size < 1 || file.size > MAX_PROOF_BYTES) return errorResponse(400, "INVALID_PROOF");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const extension = imageType(bytes, file.type);
  if (!extension) return errorResponse(400, "INVALID_PROOF");

  const auth = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const path = `${code}/${crypto.randomUUID()}.${extension}`;
  const objectUrl = (objectPath: string) =>
    `${url}/storage/v1/object/${BUCKET}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
  const remove = (objectPath: string) => fetch(`${url}/storage/v1/object/${BUCKET}`, {
    method: "DELETE",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: [objectPath] }),
  }).catch(() => null);

  const upload = await fetch(objectUrl(path), {
    method: "POST",
    headers: { ...auth, "Content-Type": file.type, "x-upsert": "false" },
    body: bytes,
  }).catch(() => null);
  if (!upload?.ok) {
    console.error("Payment proof upload failed", { status: upload?.status ?? null });
    return errorResponse(500, "SERVER_ERROR");
  }

  const recorded = await fetch(`${url}/rest/v1/rpc/submit_payment_proof`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ p_registration_code: code, p_email: email, p_path: path }),
  }).catch(() => null);
  const result = await recorded?.json().catch(() => null) as Record<string, unknown> | null;
  if (!recorded?.ok || !result) {
    await remove(path);
    const reason = typeof result?.message === "string" ? result.message : "SERVER_ERROR";
    const status = reason === "REGISTRATION_NOT_FOUND" ? 404 : reason in messages && reason !== "SERVER_ERROR" ? 409 : 500;
    return errorResponse(status, reason in messages ? reason : "SERVER_ERROR");
  }
  await inBackground(sendConfirmationEmail(url, serviceKey, { code }));
  return jsonResponse(200, { success: true, registration_code: code, registration_status: "confirmed", payment_status: "paid" });
});
