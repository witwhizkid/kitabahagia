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

const errorResponse = (status: number, code: string) => jsonResponse(status, {
  success: false,
  error: { code, message: code === "REGISTRATION_NOT_FOUND" ? "Pendaftaran tidak ditemukan." : "Data tidak valid." },
});

type StatusRequest = { registration_code: string; email: string };

type Registration = {
  id: string;
  event_id: string;
  registration_code: string;
  registration_status: string;
  payment_status: string;
  payment_deadline: string | null;
};

type Event = { whatsapp_group_url: string | null };

type Attempt = {
  order_id: string;
  status: string;
  expires_at: string | null;
};

const validateRequest = (value: unknown): StatusRequest | null => {
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

const restQuery = async <T>(url: string, key: string, path: string): Promise<T[] | null> => {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: { "Content-Type": "application/json", "apikey": key, "Authorization": `Bearer ${key}` },
  });
  if (!response.ok) return null;
  const result = await response.json().catch(() => null);
  return Array.isArray(result) ? result as T[] : null;
};

const safeWhatsAppGroupUrl = (value: string | null | undefined) => {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname === "chat.whatsapp.com"
      ? url.toString() : null;
  } catch {
    return null;
  }
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
  if (!url || !serviceKey) return errorResponse(500, "SERVER_ERROR");

  const registrationQuery = `registrations?select=id,event_id,registration_code,registration_status,payment_status,payment_deadline&registration_code=eq.${encodeURIComponent(input.registration_code)}&email=eq.${encodeURIComponent(input.email)}&limit=1`;
  const registrations = await restQuery<Registration>(url, serviceKey, registrationQuery).catch(() => null);
  const registration = registrations?.[0];
  if (!registration) return errorResponse(404, "REGISTRATION_NOT_FOUND");

  const eventQuery = `events?select=whatsapp_group_url&id=eq.${encodeURIComponent(registration.event_id)}&limit=1`;
  const events = await restQuery<Event>(url, serviceKey, eventQuery).catch(() => null);
  const isConfirmed = registration.registration_status === "confirmed"
    && ["paid", "not_required"].includes(registration.payment_status);
  const whatsappGroupUrl = isConfirmed ? safeWhatsAppGroupUrl(events?.[0]?.whatsapp_group_url) : null;

  const attemptQuery = `payment_attempts?select=order_id,status,expires_at&registration_id=eq.${encodeURIComponent(registration.id)}&order=created_at.desc&limit=1`;
  const attempts = await restQuery<Attempt>(url, serviceKey, attemptQuery).catch(() => null);
  const attempt = attempts?.[0];

  return jsonResponse(200, {
    success: true,
    registration_code: registration.registration_code,
    registration_status: registration.registration_status,
    payment_status: registration.payment_status,
    order_id: attempt?.order_id ?? null,
    expires_at: attempt?.expires_at ?? null,
    payment_deadline: registration.payment_deadline ?? null,
    whatsapp_group_url: whatsappGroupUrl,
  });
});
