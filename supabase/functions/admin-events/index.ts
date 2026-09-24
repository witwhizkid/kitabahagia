const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
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
  json(status, { events: [], error: { code, message } });

const eventProjection = [
  "slug", "title", "description", "registration_description", "activities", "benefits",
  "category", "category_key", "event_date", "start_time", "end_at", "timezone", "location",
  "price", "capacity", "registration_deadline", "status", "image_url", "image_alt",
  "whatsapp_group_url", "is_public", "is_demo", "payment_window_minutes",
  "registration_mode", "registration_opens_at", "applicant_limit", "announcement_at",
  "selection_question", "selection_min_chars", "commitment_text", "selection_requirements",
  "wa_message_accepted", "wa_message_waitlisted", "wa_message_rejected",
  "archived_at",
].join(",");

const writableFields = new Set([
  "title", "slug", "description", "registration_description", "activities", "benefits",
  "category", "category_key", "event_date", "start_time", "end_at", "timezone", "location",
  "price", "capacity", "registration_deadline", "status", "image_url", "image_alt",
  "whatsapp_group_url", "is_public", "payment_window_minutes",
  "registration_mode", "registration_opens_at", "applicant_limit", "announcement_at",
  "selection_question", "selection_min_chars", "commitment_text", "selection_requirements",
  "wa_message_accepted", "wa_message_waitlisted", "wa_message_rejected",
]);
const registrationModes = new Set(["first_come", "selection"]);
const requiredCreateFields = ["title", "slug", "event_date", "status"];
const statuses = new Set(["draft", "open", "full", "closed", "completed", "cancelled"]);
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

type Admin = { userId: string; role: "admin" | "super_admin" };
type EventRow = Record<string, unknown> & { is_demo?: boolean };

const serviceHeaders = (key: string, prefer?: string) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  ...(prefer ? { Prefer: prefer } : {}),
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
    select: "user_id,role,is_active",
    user_id: `eq.${user.id}`,
    is_active: "eq.true",
    limit: "1",
  });
  const adminResponse = await fetch(`${supabaseUrl}/rest/v1/admin_users?${query}`, {
    headers: serviceHeaders(serviceKey),
  });
  const rows = await adminResponse.json().catch(() => null) as Array<{ user_id: string; role: string }> | null;
  if (!adminResponse.ok || !Array.isArray(rows) || rows.length !== 1) return null;
  if (rows[0].role !== "admin" && rows[0].role !== "super_admin") return null;
  return { userId: user.id, role: rows[0].role } as Admin;
};

const validIsoTimestamp = (value: unknown) => {
  if (value === null) return true;
  return typeof value === "string" && value.trim() !== "" && !Number.isNaN(Date.parse(value));
};

const cleanNullableText = (value: unknown) => {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("INVALID_TEXT");
  const cleaned = value.trim();
  return cleaned || null;
};

const validatePayload = (input: unknown, creating: boolean) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "Data kegiatan tidak valid." } as const;
  }
  const source = input as Record<string, unknown>;
  const unknown = Object.keys(source).filter((key) => !writableFields.has(key));
  if (unknown.length) return { error: "Terdapat field kegiatan yang tidak didukung." } as const;
  if (creating && requiredCreateFields.some((field) => source[field] === undefined)) {
    return { error: "Judul, slug, tanggal, dan status wajib diisi." } as const;
  }

  const data: Record<string, unknown> = {};
  try {
    for (const [field, value] of Object.entries(source)) {
      if (["activities", "benefits", "selection_requirements"].includes(field)) {
        if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
          return { error: "Aktivitas, manfaat, dan persyaratan harus berupa daftar teks." } as const;
        }
        data[field] = value.map((item) => item.trim()).filter(Boolean);
      } else if (["price", "capacity"].includes(field)) {
        if (field === "capacity" && value === null) data[field] = null;
        else if (!Number.isInteger(value) || Number(value) < (field === "capacity" ? 1 : 0)) {
          return { error: field === "price" ? "Harga tidak valid." : "Kapasitas harus bilangan bulat positif." } as const;
        } else data[field] = value;
      } else if (field === "payment_window_minutes") {
        if (!Number.isInteger(value) || Number(value) < 10 || Number(value) > 1440) {
          return { error: "Batas waktu bayar harus 10 sampai 1440 menit." } as const;
        }
        data[field] = value;
      } else if (field === "registration_mode") {
        if (typeof value !== "string" || !registrationModes.has(value)) return { error: "Mode pendaftaran tidak valid." } as const;
        data[field] = value;
      } else if (field === "applicant_limit") {
        if (value !== null && (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 100000)) {
          return { error: "Batas pendaftar harus bilangan bulat positif." } as const;
        }
        data[field] = value;
      } else if (field === "selection_min_chars") {
        if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 2000) {
          return { error: "Minimal karakter jawaban harus 0 sampai 2000." } as const;
        }
        data[field] = value;
      } else if (field === "is_public") {
        if (typeof value !== "boolean") return { error: "Status tampil di website tidak valid." } as const;
        data[field] = value;
      } else if (["description", "registration_description", "category", "category_key", "start_time", "end_at", "location", "registration_deadline", "image_url", "image_alt", "whatsapp_group_url", "registration_opens_at", "announcement_at", "selection_question", "commitment_text", "wa_message_accepted", "wa_message_waitlisted", "wa_message_rejected"].includes(field)) {
        data[field] = cleanNullableText(value);
      } else if (typeof value === "string") data[field] = value.trim();
      else return { error: `${field} tidak valid.` } as const;
    }
  } catch {
    return { error: "Data teks kegiatan tidak valid." } as const;
  }

  if (data.slug !== undefined && (typeof data.slug !== "string" || data.slug.length > 120 || !slugPattern.test(data.slug))) {
    return { error: "Slug harus memakai huruf kecil, angka, dan tanda hubung." } as const;
  }
  if (data.title !== undefined && (typeof data.title !== "string" || !data.title || data.title.length > 180)) {
    return { error: "Judul kegiatan tidak valid." } as const;
  }
  if (data.event_date !== undefined && (typeof data.event_date !== "string" || !datePattern.test(data.event_date) || Number.isNaN(Date.parse(`${data.event_date}T00:00:00Z`)))) {
    return { error: "Tanggal kegiatan tidak valid." } as const;
  }
  if (data.start_time !== undefined && data.start_time !== null && (typeof data.start_time !== "string" || !timePattern.test(data.start_time))) {
    return { error: "Jam mulai tidak valid." } as const;
  }
  if (data.end_at !== undefined && !validIsoTimestamp(data.end_at)) return { error: "Waktu selesai tidak valid." } as const;
  if (data.registration_deadline !== undefined && !validIsoTimestamp(data.registration_deadline)) return { error: "Batas pendaftaran tidak valid." } as const;
  if (data.registration_opens_at !== undefined && !validIsoTimestamp(data.registration_opens_at)) return { error: "Jam buka pendaftaran tidak valid." } as const;
  if (data.announcement_at !== undefined && !validIsoTimestamp(data.announcement_at)) return { error: "Tanggal pengumuman tidak valid." } as const;
  if (typeof data.selection_question === "string" && data.selection_question.length > 500) return { error: "Pertanyaan seleksi maksimal 500 karakter." } as const;
  if (typeof data.commitment_text === "string" && data.commitment_text.length > 300) return { error: "Teks komitmen maksimal 300 karakter." } as const;
  if (Array.isArray(data.selection_requirements) && (data.selection_requirements.length > 15
    || (data.selection_requirements as string[]).some((item) => item.length > 500))) {
    return { error: "Persyaratan maksimal 15 poin, masing-masing maksimal 500 karakter." } as const;
  }
  for (const field of ["wa_message_accepted", "wa_message_waitlisted", "wa_message_rejected"]) {
    if (typeof data[field] === "string" && (data[field] as string).length > 1000) return { error: "Pesan WhatsApp maksimal 1000 karakter." } as const;
  }
  // Only checked when the form sends both (it always does); the database has no such constraint.
  if (data.registration_mode === "selection" && typeof data.price === "number" && data.price > 0) {
    return { error: "Mode seleksi hanya untuk kegiatan gratis." } as const;
  }
  if (data.status !== undefined && (typeof data.status !== "string" || !statuses.has(data.status))) return { error: "Status kegiatan tidak valid." } as const;
  if (data.timezone !== undefined) {
    if (typeof data.timezone !== "string" || !data.timezone || data.timezone.length > 64) return { error: "Zona waktu tidak valid." } as const;
    try { new Intl.DateTimeFormat("en", { timeZone: data.timezone }); } catch { return { error: "Zona waktu tidak valid." } as const; }
  }
  if (data.whatsapp_group_url !== undefined && data.whatsapp_group_url !== null) {
    try {
      const url = new URL(String(data.whatsapp_group_url));
      if (url.protocol !== "https:" || url.hostname !== "chat.whatsapp.com" || url.pathname.length <= 1) throw new Error();
      data.whatsapp_group_url = url.toString();
    } catch { return { error: "Link grup WhatsApp harus memakai https://chat.whatsapp.com/." } as const; }
  }
  return { data } as const;
};

const presentEvent = (row: EventRow) => {
  const { is_demo, ...event } = row;
  return { ...event, environment: is_demo ? "development" : "production" };
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders });
  if (!["GET", "POST", "PATCH", "DELETE"].includes(request.method)) return fail(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return fail(500, "SERVER_ERROR", "Konfigurasi server belum lengkap.");

  const admin = await authorize(request, supabaseUrl, anonKey, serviceKey);
  if (!admin) return fail(401, "UNAUTHORIZED", "Sesi admin tidak valid atau akses tidak diizinkan.");

  const url = new URL(request.url);
  const requestedSlug = url.searchParams.get("slug")?.trim().toLowerCase() || null;
  const action = url.searchParams.get("action")?.trim().toLowerCase() || null;
  if (requestedSlug && !slugPattern.test(requestedSlug)) return fail(400, "INVALID_SLUG", "Slug kegiatan tidak valid.");
  if (action && (!requestedSlug || request.method !== "PATCH" || !["archive", "restore"].includes(action))) {
    return fail(400, "INVALID_ACTION", "Aksi arsip kegiatan tidak valid.");
  }

  if (request.method === "GET") {
    const query = new URLSearchParams({ select: eventProjection, order: "event_date.desc,start_time.desc,slug.asc" });
    if (requestedSlug) query.set("slug", `eq.${requestedSlug}`);
    const response = await fetch(`${supabaseUrl}/rest/v1/events?${query}`, { headers: serviceHeaders(serviceKey) });
    const rows = await response.json().catch(() => null) as EventRow[] | null;
    if (!response.ok || !Array.isArray(rows)) return fail(500, "SERVER_ERROR", "Data kegiatan belum dapat dimuat.");
    return json(200, { events: rows.map(presentEvent), role: admin.role });
  }

  if (action) {
    const endpoint = `${supabaseUrl}/rest/v1/events?slug=eq.${encodeURIComponent(requestedSlug!)}&select=${encodeURIComponent(eventProjection)}`;
    const response = await fetch(endpoint, {
      method: "PATCH",
      headers: serviceHeaders(serviceKey, "return=representation"),
      body: JSON.stringify({ archived_at: action === "archive" ? new Date().toISOString() : null }),
    });
    const rows = await response.json().catch(() => null) as EventRow[] | null;
    if (!response.ok || !Array.isArray(rows)) return fail(500, "SERVER_ERROR", "Arsip kegiatan belum dapat diperbarui.");
    if (rows.length === 0) return fail(404, "EVENT_NOT_FOUND", "Kegiatan tidak ditemukan.");
    return json(200, { events: rows.map(presentEvent), role: admin.role });
  }

  if (request.method === "DELETE") {
    if (!requestedSlug) return fail(400, "INVALID_SLUG", "Slug kegiatan yang akan dihapus wajib disertakan.");
    const currentResponse = await fetch(
      `${supabaseUrl}/rest/v1/events?slug=eq.${encodeURIComponent(requestedSlug)}&select=id,archived_at&limit=1`,
      { headers: serviceHeaders(serviceKey) },
    );
    const currentRows = await currentResponse.json().catch(() => null) as Array<{ id: string; archived_at: string | null }> | null;
    if (!currentResponse.ok || !Array.isArray(currentRows)) return fail(500, "SERVER_ERROR", "Kegiatan belum dapat diperiksa.");
    if (currentRows.length !== 1) return fail(404, "EVENT_NOT_FOUND", "Kegiatan tidak ditemukan.");
    if (!currentRows[0].archived_at) return fail(409, "EVENT_NOT_ARCHIVED", "Kegiatan aktif tidak dapat dihapus permanen. Arsipkan kegiatan terlebih dahulu.");

    const registrationResponse = await fetch(
      `${supabaseUrl}/rest/v1/registrations?event_id=eq.${encodeURIComponent(currentRows[0].id)}&select=id&limit=1`,
      { headers: serviceHeaders(serviceKey) },
    );
    const registrationRows = await registrationResponse.json().catch(() => null) as Array<{ id: string }> | null;
    if (!registrationResponse.ok || !Array.isArray(registrationRows)) return fail(500, "SERVER_ERROR", "Data pendaftar belum dapat diperiksa.");
    if (registrationRows.length > 0) return fail(409, "EVENT_HAS_HISTORY", "Kegiatan ini memiliki data pendaftar atau transaksi dan tidak dapat dihapus permanen.");

    const deleteResponse = await fetch(
      `${supabaseUrl}/rest/v1/events?slug=eq.${encodeURIComponent(requestedSlug)}&archived_at=not.is.null`,
      { method: "DELETE", headers: serviceHeaders(serviceKey, "return=representation") },
    );
    const deletedRows = await deleteResponse.json().catch(() => null) as EventRow[] | null;
    if (deleteResponse.status === 409) return fail(409, "EVENT_HAS_HISTORY", "Kegiatan ini memiliki data pendaftar atau transaksi dan tidak dapat dihapus permanen.");
    if (!deleteResponse.ok || !Array.isArray(deletedRows)) return fail(500, "SERVER_ERROR", "Kegiatan belum dapat dihapus permanen.");
    if (deletedRows.length === 0) return fail(404, "EVENT_NOT_FOUND", "Kegiatan tidak ditemukan atau sudah tidak diarsipkan.");
    return json(200, { events: deletedRows.map(presentEvent), role: admin.role });
  }

  if (request.method === "PATCH" && !requestedSlug) return fail(400, "INVALID_SLUG", "Slug kegiatan yang akan diubah wajib disertakan.");
  const payload = await request.json().catch(() => null);
  const validated = validatePayload(payload, request.method === "POST");
  if ("error" in validated && typeof validated.error === "string") {
    return fail(400, "INVALID_EVENT", validated.error);
  }
  if (request.method === "PATCH" && Object.keys(validated.data).length === 0) return fail(400, "INVALID_EVENT", "Tidak ada perubahan untuk disimpan.");

  const endpoint = request.method === "POST"
    ? `${supabaseUrl}/rest/v1/events?select=${encodeURIComponent(eventProjection)}`
    : `${supabaseUrl}/rest/v1/events?slug=eq.${encodeURIComponent(requestedSlug!)}&select=${encodeURIComponent(eventProjection)}`;
  const response = await fetch(endpoint, {
    method: request.method,
    headers: serviceHeaders(serviceKey, "return=representation"),
    body: JSON.stringify(request.method === "POST" ? { ...validated.data, is_demo: false } : validated.data),
  });
  const rows = await response.json().catch(() => null) as EventRow[] | { code?: string } | null;
  if (response.status === 409) return fail(409, "SLUG_EXISTS", "Slug sudah digunakan kegiatan lain.");
  if (!response.ok || !Array.isArray(rows)) return fail(500, "SERVER_ERROR", "Kegiatan belum dapat disimpan.");
  if (request.method === "PATCH" && rows.length === 0) return fail(404, "EVENT_NOT_FOUND", "Kegiatan tidak ditemukan.");
  return json(request.method === "POST" ? 201 : 200, { events: rows.map(presentEvent), role: admin.role });
});
