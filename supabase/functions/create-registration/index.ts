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
const errorResponse = (status: number, code: string, message: string) =>
  jsonResponse(status, { success: false, error: { code, message } });

const errorMessages: Record<string, string> = {
  INVALID_REQUEST: "Data pendaftaran tidak valid.",
  EVENT_NOT_FOUND: "Kegiatan tidak ditemukan.",
  EVENT_NOT_OPEN: "Kegiatan tidak sedang menerima pendaftaran.",
  REGISTRATION_CLOSED: "Batas waktu pendaftaran telah berakhir.",
  EVENT_FULL: "Kapasitas kegiatan sudah penuh.",
};
const conflictErrors = new Set(["EVENT_NOT_OPEN", "REGISTRATION_CLOSED", "EVENT_FULL"]);
const allowedFields = new Set(["event_slug", "name", "phone", "email", "domicile", "institution", "reason", "notes", "consent"]);

type RegistrationInput = {
  event_slug: string; name: string; phone: string; email: string;
  domicile: string | null; institution: string | null;
  reason: string; notes: string | null; consent: true;
};

const normalizePhone = (value: string) => {
  const compact = value.trim().replace(/[\s().-]/g, "");
  return compact;
};

const validateInput = (value: unknown): RegistrationInput | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !allowedFields.has(key))) return null;
  if (typeof body.event_slug !== "string" || typeof body.name !== "string"
    || typeof body.phone !== "string" || typeof body.email !== "string"
    || typeof body.reason !== "string" || body.consent !== true
    || (body.domicile !== undefined && body.domicile !== null && typeof body.domicile !== "string")
    || (body.institution !== undefined && body.institution !== null && typeof body.institution !== "string")
    || (body.notes !== undefined && body.notes !== null && typeof body.notes !== "string")) return null;

  const eventSlug = body.event_slug.trim().toLowerCase();
  const name = body.name.trim();
  if (!/^\+?[0-9\s().-]+$/.test(body.phone.trim())) return null;
  const phone = normalizePhone(body.phone);
  const email = body.email.trim().toLowerCase();
  const domicile = typeof body.domicile === "string" ? body.domicile.trim() || null : null;
  const institution = typeof body.institution === "string" ? body.institution.trim() || null : null;
  const reason = body.reason.trim();
  const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(eventSlug) || eventSlug.length > 120
    || name.length < 2 || name.length > 150 || !/^\+?\d{8,20}$/.test(phone)
    || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || (domicile !== null && domicile.length > 200)
    || (institution !== null && institution.length > 200)
    || reason.length < 1 || reason.length > 2000
    || (notes !== null && notes.length > 2000)) return null;
  return { event_slug: eventSlug, name, phone, email, domicile, institution, reason, notes, consent: true };
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return errorResponse(405, "INVALID_REQUEST", "Gunakan metode POST.");
  if (!(request.headers.get("content-type")?.toLowerCase() ?? "").includes("application/json")) {
    return errorResponse(400, "INVALID_REQUEST", errorMessages.INVALID_REQUEST);
  }

  let body: unknown;
  try { body = await request.json(); }
  catch { return errorResponse(400, "INVALID_REQUEST", errorMessages.INVALID_REQUEST); }
  const input = validateInput(body);
  if (!input) return errorResponse(400, "INVALID_REQUEST", errorMessages.INVALID_REQUEST);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing required Supabase server environment variables");
    return errorResponse(500, "SERVER_ERROR", "Terjadi kesalahan pada server.");
  }

  try {
    const rpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/create_registration`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": serviceRoleKey, "Authorization": `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({
        p_event_slug: input.event_slug, p_name: input.name, p_phone: input.phone,
        p_email: input.email, p_reason: input.reason, p_notes: input.notes, p_consent: input.consent,
        p_domicile: input.domicile, p_institution: input.institution,
      }),
    });
    const result = await rpcResponse.json().catch(() => null) as Record<string, unknown> | null;
    if (rpcResponse.ok && result) return jsonResponse(201, result);

    const databaseCode = typeof result?.message === "string" ? result.message : "";
    if (databaseCode in errorMessages) {
      const status = databaseCode === "EVENT_NOT_FOUND" ? 404 : conflictErrors.has(databaseCode) ? 409 : 400;
      return errorResponse(status, databaseCode, errorMessages[databaseCode]);
    }
    console.error("Registration RPC failed", { status: rpcResponse.status, code: result?.code });
    return errorResponse(500, "SERVER_ERROR", "Terjadi kesalahan pada server.");
  } catch (error) {
    console.error("Registration request failed", error instanceof Error ? error.message : "Unknown error");
    return errorResponse(500, "SERVER_ERROR", "Terjadi kesalahan pada server.");
  }
});
