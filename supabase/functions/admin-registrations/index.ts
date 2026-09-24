const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
  "notes",
  "selection_question",
  "selection_answer",
  "commitment_text",
  "portfolio_url",
  "selection_decided_at",
  "registration_status",
  "payment_status",
  "payment_deadline",
  "created_at",
  "events!inner(slug,title,event_date,start_time,end_at,registration_mode)",
].join(",");

// "expired" is derived, not stored: a pending_payment row whose payment_deadline
// has passed. It matches the lazy seat release rule, so the seat is already free.
const registrationStatuses = new Set(["pending_payment", "confirmed", "cancelled", "expired", "applied", "waitlisted", "rejected"]);
const decisions = new Set(["accepted", "waitlisted", "rejected", "applied"]);
const registrationCodePattern = /^KB-[A-Z0-9-]{6,40}$/;
const decisionErrors: Record<string, [number, string]> = {
  CAPACITY_EXCEEDED: [409, "Kuota peserta sudah penuh. Pindahkan peserta lain ke cadangan dulu."],
  NOT_SELECTION_EVENT: [400, "Keputusan seleksi hanya untuk kegiatan mode Seleksi."],
  INVALID_DECISION: [400, "Keputusan tidak valid."],
  INVALID_REQUEST: [400, "Pilih pendaftar dari satu kegiatan saja."],
};
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
  if (!token) return null;

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  if (!userResponse.ok) return null;
  const user = await userResponse.json().catch(() => null) as { id?: string } | null;
  if (!user?.id) return null;

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
  // The admin's user id, recorded with each selection decision; null when not an active admin.
  return adminResponse.ok && Array.isArray(rows) && rows.length === 1 ? user.id : null;
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
  if (!["GET", "POST"].includes(request.method)) return fail(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return fail(500, "SERVER_ERROR", "Konfigurasi server belum lengkap.");
  const adminId = await authorize(request, supabaseUrl, anonKey, serviceKey);
  if (!adminId) {
    return fail(401, "UNAUTHORIZED", "Sesi admin tidak valid atau akses tidak diizinkan.");
  }

  const rpc = (name: string, args: Record<string, unknown>) => fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });

  // POST: accept / waitlist / reject / reset one or more applicants of one selection event.
  if (request.method === "POST") {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const codes = body?.registration_codes;
    const decision = body?.decision;
    if (!body || Object.keys(body).some((key) => !["registration_codes", "decision"].includes(key))
      || !Array.isArray(codes) || codes.length < 1 || codes.length > 500
      || codes.some((code) => typeof code !== "string" || !registrationCodePattern.test(code))
      || typeof decision !== "string" || !decisions.has(decision)) {
      return fail(400, "INVALID_REQUEST", "Data keputusan tidak valid.");
    }
    const response = await rpc("decide_selection", { p_registration_codes: codes, p_decision: decision, p_actor: adminId });
    const result = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (response.ok && result) return json(200, { registrations: [], total: 0, selection: result });
    const code = typeof result?.message === "string" ? result.message : "";
    const [status, message] = decisionErrors[code] ?? [500, "Keputusan belum dapat disimpan."];
    return fail(status, code in decisionErrors ? code : "SERVER_ERROR", message);
  }

  const url = new URL(request.url);
  // Private files (Instagram proof, CV) of one free selection applicant, as short-lived signed URLs.
  const proofCode = url.searchParams.get("proof");
  if (proofCode !== null) {
    if (!registrationCodePattern.test(proofCode)) return fail(400, "INVALID_REQUEST", "Kode pendaftar tidak valid.");
    const proofQuery = new URLSearchParams({
      select: "instagram_proof_path,cv_path,events!inner(slug,price,registration_mode)",
      registration_code: `eq.${proofCode}`,
      limit: "1",
    });
    const proofResponse = await fetch(`${supabaseUrl}/rest/v1/registrations?${proofQuery}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: "application/json" },
    });
    const proofRows = await proofResponse.json().catch(() => null) as Array<Record<string, unknown>> | null;
    if (!proofResponse.ok || !Array.isArray(proofRows)) return fail(500, "SERVER_ERROR", "Berkas pendaftar belum dapat dimuat.");
    const row = proofRows[0];
    const event = row?.events as { slug?: string; price?: number; registration_mode?: string } | undefined;
    if (!row || event?.registration_mode !== "selection" || Number(event.price) !== 0) {
      return json(200, { proof: null, cv: null });
    }

    const expiresIn = 600;
    const sign = async (bucket: string, path: unknown, extensions: string) => {
      if (typeof path !== "string" || !path.startsWith(`${event.slug}/`)) return null;
      const objectName = path.split("/").at(-1) || "";
      if (!new RegExp(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(${extensions})$`).test(objectName)) {
        throw new Error("INVALID_PATH");
      }
      const encodedPath = path.split("/").map(encodeURIComponent).join("/");
      const signedResponse = await fetch(`${supabaseUrl}/storage/v1/object/sign/${bucket}/${encodedPath}`, {
        method: "POST",
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn }),
      });
      const signedResult = await signedResponse.json().catch(() => null) as { signedURL?: string; signedUrl?: string } | null;
      const signedPath = signedResult?.signedURL || signedResult?.signedUrl;
      if (!signedResponse.ok || typeof signedPath !== "string") {
        console.error("Private file signing failed", { bucket, status: signedResponse.status });
        throw new Error("SIGN_FAILED");
      }
      // Storage answers "/object/sign/..." relative to /storage/v1 (as supabase-js assumes).
      const signedUrl = new URL(signedPath.startsWith("/object/") ? `${supabaseUrl}/storage/v1${signedPath}` : signedPath, supabaseUrl);
      if (signedUrl.origin !== new URL(supabaseUrl).origin || !signedUrl.pathname.startsWith("/storage/v1/object/sign/")) {
        throw new Error("INVALID_SIGNED_URL");
      }
      return { signed_url: signedUrl.href, expires_in: expiresIn };
    };
    try {
      return json(200, {
        proof: await sign("instagram-proofs", row.instagram_proof_path, "jpg|png|webp"),
        cv: await sign("selection-cvs", row.cv_path, "pdf"),
      });
    } catch {
      return fail(500, "SERVER_ERROR", "Berkas pendaftar belum dapat dibuka.");
    }
  }

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
  // Archived events (e.g. sandbox tests) are hidden from the registrant list; restore the event to see them.
  query.set("events.archived_at", "is.null");
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

  // With one event selected, add the selection counts and each applicant's history.
  let selection: unknown = null;
  if (eventSlug) {
    const overview = await rpc("selection_overview", { p_event_slug: eventSlug });
    selection = overview.ok ? await overview.json().catch(() => null) : null;
  }

  return json(200, { registrations: lifecycleRows, total: lifecycleRows.length, selection });
});
