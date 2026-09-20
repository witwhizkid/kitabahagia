const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const responseHeaders = {
  ...corsHeaders,
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: responseHeaders });

const fail = (status: number, code: string, message: string) =>
  json(status, { registrations: [], total: 0, error: { code, message } });

const registrationProjection = [
  "registration_code",
  "name",
  "phone",
  "email",
  "registration_status",
  "payment_status",
  "created_at",
  "events!inner(slug,title)",
].join(",");

const registrationStatuses = new Set(["pending_payment", "confirmed", "cancelled"]);
const paymentStatuses = new Set(["not_required", "unpaid", "pending", "paid", "failed", "expired", "refunded"]);
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const serviceHeaders = (key: string) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  Accept: "application/json",
  Prefer: "count=exact",
  Range: "0-499",
});

const authorize = async (request: Request, supabaseUrl: string, anonKey: string, serviceKey: string) => {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return false;

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  if (!userResponse.ok) return false;
  const user = await userResponse.json().catch(() => null) as { id?: string } | null;
  if (!user?.id) return false;

  const query = new URLSearchParams({
    select: "user_id",
    user_id: `eq.${user.id}`,
    is_active: "eq.true",
    role: "in.(admin,super_admin)",
    limit: "1",
  });
  const adminResponse = await fetch(`${supabaseUrl}/rest/v1/admin_users?${query}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: "application/json" },
  });
  const rows = await adminResponse.json().catch(() => null);
  return adminResponse.ok && Array.isArray(rows) && rows.length === 1;
};

const safeSearch = (value: string | null) => {
  if (!value) return null;
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > 100 || /[(),*\x00-\x1f\x7f]/.test(cleaned)) return false;
  return cleaned;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders });
  if (request.method !== "GET") return fail(405, "METHOD_NOT_ALLOWED", "Pendaftar hanya dapat dilihat.");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return fail(500, "SERVER_ERROR", "Konfigurasi server belum lengkap.");
  if (!await authorize(request, supabaseUrl, anonKey, serviceKey)) {
    return fail(401, "UNAUTHORIZED", "Sesi admin tidak valid atau akses tidak diizinkan.");
  }

  const url = new URL(request.url);
  const eventSlug = url.searchParams.get("event")?.trim().toLowerCase() || null;
  const registrationStatus = url.searchParams.get("registration_status")?.trim() || null;
  const paymentStatus = url.searchParams.get("payment_status")?.trim() || null;
  const search = safeSearch(url.searchParams.get("search"));

  if (eventSlug && !slugPattern.test(eventSlug)) return fail(400, "INVALID_EVENT", "Filter kegiatan tidak valid.");
  if (registrationStatus && !registrationStatuses.has(registrationStatus)) return fail(400, "INVALID_STATUS", "Status pendaftaran tidak valid.");
  if (paymentStatus && !paymentStatuses.has(paymentStatus)) return fail(400, "INVALID_STATUS", "Status pembayaran tidak valid.");
  if (search === false) return fail(400, "INVALID_SEARCH", "Pencarian tidak valid.");

  const query = new URLSearchParams({
    select: registrationProjection,
    order: "created_at.desc",
  });
  if (eventSlug) query.set("events.slug", `eq.${eventSlug}`);
  if (registrationStatus) query.set("registration_status", `eq.${registrationStatus}`);
  if (paymentStatus) query.set("payment_status", `eq.${paymentStatus}`);
  if (search) {
    query.set("or", `(name.ilike.*${search}*,email.ilike.*${search}*,registration_code.ilike.*${search}*)`);
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/registrations?${query}`, {
    headers: serviceHeaders(serviceKey),
  });
  const rows = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(rows)) return fail(500, "SERVER_ERROR", "Data pendaftar belum dapat dimuat.");

  const contentRange = response.headers.get("content-range")?.split("/")[1];
  const total = contentRange && contentRange !== "*" ? Number(contentRange) : rows.length;
  return json(200, { registrations: rows, total: Number.isSafeInteger(total) ? total : rows.length });
});
