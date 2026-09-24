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
  "domicile",
  "institution",
  "reason",
  "selection_answer",
  "registration_status",
  "payment_status",
  "payment_deadline",
  "created_at",
  "events!inner(slug,title,event_date,start_time,end_at)",
].join(",");

// "expired" is derived, not stored: a pending_payment row whose payment_deadline
// has passed. It matches the lazy seat release rule, so the seat is already free.
const registrationStatuses = new Set(["pending_payment", "confirmed", "cancelled", "expired", "applied"]);
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

const isPaymentExpired = (registration: Record<string, unknown>, now: Date) => {
  if (registration.registration_status !== "pending_payment" || registration.payment_status === "paid") return false;
  const deadline = typeof registration.payment_deadline === "string" ? new Date(registration.payment_deadline) : null;
  return Boolean(deadline && !Number.isNaN(deadline.getTime()) && deadline <= now);
};

const eventFinishedAt = (event: { end_at?: string | null; event_date?: string | null; start_time?: string | null }) => {
  if (event.end_at) {
    const endAt = new Date(event.end_at);
    if (!Number.isNaN(endAt.getTime())) return endAt;
  }
  if (!event.event_date) return null;
  const endOfEventDay = new Date(`${event.event_date}T23:59:59+07:00`);
  return Number.isNaN(endOfEventDay.getTime()) ? null : endOfEventDay;
};

const isActiveRegistration = (event: { end_at?: string | null; event_date?: string | null; start_time?: string | null }, now: Date) => {
  const finishedAt = eventFinishedAt(event);
  if (!finishedAt) return true;
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return finishedAt >= thirtyDaysAgo;
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
  const lifecycle = url.searchParams.get("lifecycle")?.trim().toLowerCase() || "active";
  const search = safeSearch(url.searchParams.get("search"));

  if (eventSlug && !slugPattern.test(eventSlug)) return fail(400, "INVALID_EVENT", "Filter kegiatan tidak valid.");
  if (registrationStatus && !registrationStatuses.has(registrationStatus)) return fail(400, "INVALID_STATUS", "Status pendaftaran tidak valid.");
  if (paymentStatus && !paymentStatuses.has(paymentStatus)) return fail(400, "INVALID_STATUS", "Status pembayaran tidak valid.");
  if (!["active", "history"].includes(lifecycle)) return fail(400, "INVALID_LIFECYCLE", "Tampilan pendaftar tidak valid.");
  if (search === false) return fail(400, "INVALID_SEARCH", "Pencarian tidak valid.");

  const query = new URLSearchParams({
    select: registrationProjection,
    order: "created_at.desc",
  });
  if (eventSlug) query.set("events.slug", `eq.${eventSlug}`);
  if (registrationStatus) {
    query.set("registration_status", `eq.${registrationStatus === "expired" ? "pending_payment" : registrationStatus}`);
  }
  if (paymentStatus) {
    query.set("payment_status", paymentStatus === "expired" ? "in.(expired,unpaid,pending,failed)" : `eq.${paymentStatus}`);
  }
  if (search) {
    query.set("or", `(name.ilike.*${search}*,email.ilike.*${search}*,registration_code.ilike.*${search}*)`);
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/registrations?${query}`, {
    headers: serviceHeaders(serviceKey),
  });
  const rows = await response.json().catch(() => null) as Array<Record<string, unknown>> | null;
  if (!response.ok || !Array.isArray(rows)) return fail(500, "SERVER_ERROR", "Data pendaftar belum dapat dimuat.");

  const now = new Date();
  const lifecycleRows = rows.map((registration) => ({
    ...registration,
    payment_expired: isPaymentExpired(registration, now),
  })).filter((registration) => {
    const expired = registration.payment_expired;
    if (registrationStatus === "expired" && !expired) return false;
    if (registrationStatus === "pending_payment" && expired) return false;
    if (paymentStatus === "expired" && !expired && registration.payment_status !== "expired") return false;
    if (["unpaid", "pending", "failed"].includes(paymentStatus || "") && expired) return false;
    const event = (registration.events || {}) as { end_at?: string | null; event_date?: string | null; start_time?: string | null };
    return lifecycle === "active" ? isActiveRegistration(event, now) : !isActiveRegistration(event, now);
  });

  return json(200, { registrations: lifecycleRows, total: lifecycleRows.length });
});
