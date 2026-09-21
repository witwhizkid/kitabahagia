const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
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
  json(status, { stories: [], error: { code, message } });

const storyProjection = [
  "slug",
  "title",
  "excerpt",
  "body",
  "cover_image_url",
  "cover_image_alt",
  "status",
  "published_at",
  "archived_at",
].join(",");

const writableFields = new Set([
  "slug",
  "title",
  "excerpt",
  "body",
  "cover_image_url",
  "cover_image_alt",
  "status",
  "published_at",
]);
const requiredCreateFields = ["slug", "title", "body"];
const statuses = new Set(["draft", "published"]);
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type Admin = { userId: string; role: "admin" | "super_admin" };
type StoryRow = Record<string, unknown> & { status: string; published_at: string | null };

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
    role: "in.(admin,super_admin)",
    limit: "1",
  });
  const adminResponse = await fetch(`${supabaseUrl}/rest/v1/admin_users?${query}`, {
    headers: serviceHeaders(serviceKey),
  });
  const rows = await adminResponse.json().catch(() => null) as Array<{ user_id: string; role: string }> | null;
  if (!adminResponse.ok || !Array.isArray(rows) || rows.length !== 1) return null;
  return { userId: user.id, role: rows[0].role } as Admin;
};

const cleanNullableText = (value: unknown, maxLength: number) => {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("INVALID_TEXT");
  const cleaned = value.trim();
  if (cleaned.length > maxLength) throw new Error("TEXT_TOO_LONG");
  return cleaned || null;
};

const validatePayload = (input: unknown, creating: boolean) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "Data kisah tidak valid." } as const;
  const source = input as Record<string, unknown>;
  const unknown = Object.keys(source).filter((key) => !writableFields.has(key));
  if (unknown.length) return { error: "Terdapat field kisah yang tidak didukung." } as const;
  if (creating && requiredCreateFields.some((field) => source[field] === undefined)) {
    return { error: "Judul, slug, dan isi kisah wajib diisi." } as const;
  }

  const data: Record<string, unknown> = {};
  try {
    for (const [field, value] of Object.entries(source)) {
      if (field === "slug") {
        if (typeof value !== "string") return { error: "Slug kisah tidak valid." } as const;
        data.slug = value.trim().toLowerCase();
      } else if (field === "title") {
        if (typeof value !== "string") return { error: "Judul kisah tidak valid." } as const;
        data.title = value.trim();
      } else if (field === "body") {
        if (typeof value !== "string") return { error: "Isi kisah tidak valid." } as const;
        data.body = value.trim();
      } else if (field === "excerpt") data.excerpt = cleanNullableText(value, 1200);
      else if (field === "cover_image_url") data.cover_image_url = cleanNullableText(value, 2048);
      else if (field === "cover_image_alt") data.cover_image_alt = cleanNullableText(value, 500);
      else if (field === "status") data.status = value;
      else if (field === "published_at") data.published_at = value;
    }
  } catch {
    return { error: "Data teks kisah tidak valid atau terlalu panjang." } as const;
  }

  if (data.slug !== undefined && (typeof data.slug !== "string" || data.slug.length > 140 || !slugPattern.test(data.slug))) {
    return { error: "Slug harus memakai huruf kecil, angka, dan tanda hubung." } as const;
  }
  if (data.title !== undefined && (typeof data.title !== "string" || !data.title || data.title.length > 220)) {
    return { error: "Judul kisah wajib diisi dan maksimal 220 karakter." } as const;
  }
  if (data.body !== undefined && (typeof data.body !== "string" || !data.body || data.body.length > 100000)) {
    return { error: "Isi kisah wajib diisi dan maksimal 100.000 karakter." } as const;
  }
  if (data.status !== undefined && (typeof data.status !== "string" || !statuses.has(data.status))) {
    return { error: "Status kisah tidak valid." } as const;
  }
  if (data.published_at !== undefined && data.published_at !== null && (
    typeof data.published_at !== "string" || !data.published_at.trim() || Number.isNaN(Date.parse(data.published_at))
  )) return { error: "Tanggal terbit tidak valid." } as const;

  return { data } as const;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders });
  if (!["GET", "POST", "PATCH"].includes(request.method)) return fail(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return fail(500, "SERVER_ERROR", "Konfigurasi server belum lengkap.");
  if (!await authorize(request, supabaseUrl, anonKey, serviceKey)) {
    return fail(401, "UNAUTHORIZED", "Sesi admin tidak valid atau akses tidak diizinkan.");
  }

  const url = new URL(request.url);
  const requestedSlug = url.searchParams.get("slug")?.trim().toLowerCase() || null;
  const action = url.searchParams.get("action")?.trim().toLowerCase() || null;
  if (requestedSlug && !slugPattern.test(requestedSlug)) return fail(400, "INVALID_SLUG", "Slug kisah tidak valid.");
  if (action && (!requestedSlug || request.method !== "PATCH" || !["archive", "restore"].includes(action))) {
    return fail(400, "INVALID_ACTION", "Aksi arsip kisah tidak valid.");
  }

  if (request.method === "GET") {
    const query = new URLSearchParams({ select: storyProjection, order: "published_at.desc.nullslast,title.asc" });
    if (requestedSlug) query.set("slug", `eq.${requestedSlug}`);
    const response = await fetch(`${supabaseUrl}/rest/v1/stories?${query}`, { headers: serviceHeaders(serviceKey) });
    const stories = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(stories)) return fail(500, "SERVER_ERROR", "Data kisah belum dapat dimuat.");
    return json(200, { stories });
  }

  if (action) {
    const endpoint = `${supabaseUrl}/rest/v1/stories?slug=eq.${encodeURIComponent(requestedSlug!)}&select=${encodeURIComponent(storyProjection)}`;
    const response = await fetch(endpoint, {
      method: "PATCH",
      headers: serviceHeaders(serviceKey, "return=representation"),
      body: JSON.stringify({ archived_at: action === "archive" ? new Date().toISOString() : null }),
    });
    const stories = await response.json().catch(() => null) as StoryRow[] | null;
    if (!response.ok || !Array.isArray(stories)) return fail(500, "SERVER_ERROR", "Arsip kisah belum dapat diperbarui.");
    if (stories.length === 0) return fail(404, "STORY_NOT_FOUND", "Kisah tidak ditemukan.");
    return json(200, { stories });
  }

  if (request.method === "PATCH" && !requestedSlug) return fail(400, "INVALID_SLUG", "Slug kisah yang akan diubah wajib disertakan.");
  const payload = await request.json().catch(() => null);
  const validated = validatePayload(payload, request.method === "POST");
  if ("error" in validated) return fail(400, "INVALID_STORY", validated.error ?? "Data kisah tidak valid.");
  if (request.method === "PATCH" && Object.keys(validated.data).length === 0) {
    return fail(400, "INVALID_STORY", "Tidak ada perubahan untuk disimpan.");
  }

  let current: StoryRow | null = null;
  if (request.method === "PATCH") {
    const currentQuery = new URLSearchParams({ select: "status,published_at", slug: `eq.${requestedSlug}`, limit: "1" });
    const currentResponse = await fetch(`${supabaseUrl}/rest/v1/stories?${currentQuery}`, { headers: serviceHeaders(serviceKey) });
    const rows = await currentResponse.json().catch(() => null) as StoryRow[] | null;
    if (!currentResponse.ok || !Array.isArray(rows)) return fail(500, "SERVER_ERROR", "Kisah belum dapat diperiksa.");
    if (rows.length !== 1) return fail(404, "STORY_NOT_FOUND", "Kisah tidak ditemukan.");
    current = rows[0];
  }

  const data = { ...validated.data };
  const resultingStatus = String(data.status ?? current?.status ?? "draft");
  const resultingPublishedAt = Object.hasOwn(data, "published_at") ? data.published_at : current?.published_at;
  if (resultingStatus === "published" && !resultingPublishedAt) data.published_at = new Date().toISOString();

  const endpoint = request.method === "POST"
    ? `${supabaseUrl}/rest/v1/stories?select=${encodeURIComponent(storyProjection)}`
    : `${supabaseUrl}/rest/v1/stories?slug=eq.${encodeURIComponent(requestedSlug!)}&select=${encodeURIComponent(storyProjection)}`;
  const response = await fetch(endpoint, {
    method: request.method,
    headers: serviceHeaders(serviceKey, "return=representation"),
    body: JSON.stringify(data),
  });
  const stories = await response.json().catch(() => null);
  if (response.status === 409) return fail(409, "SLUG_EXISTS", "Slug sudah digunakan kisah lain.");
  if (!response.ok || !Array.isArray(stories)) return fail(500, "SERVER_ERROR", "Kisah belum dapat disimpan.");
  if (request.method === "PATCH" && stories.length === 0) return fail(404, "STORY_NOT_FOUND", "Kisah tidak ditemukan.");
  return json(request.method === "POST" ? 201 : 200, { stories });
});
