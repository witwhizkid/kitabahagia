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
  json(status, { admins: [], error: { code, message } });

const roles = new Set(["admin", "super_admin"]);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const adminProjection = "user_id,role,is_active,created_at";

type AdminRole = "admin" | "super_admin";
type AuthorizedAdmin = { userId: string; role: AdminRole };
type AdminRow = { user_id: string; role: AdminRole; is_active: boolean; created_at: string };
type AuthUser = { id: string; email?: string };

const serviceHeaders = (key: string, prefer?: string) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  ...(prefer ? { Prefer: prefer } : {}),
});

const authorize = async (
  request: Request,
  supabaseUrl: string,
  anonKey: string,
  serviceKey: string,
): Promise<{ admin?: AuthorizedAdmin; status?: number }> => {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { status: 401 };

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  if (!userResponse.ok) return { status: 401 };
  const user = await userResponse.json().catch(() => null) as { id?: string } | null;
  if (!user?.id) return { status: 401 };

  const query = new URLSearchParams({
    select: "user_id,role,is_active",
    user_id: `eq.${user.id}`,
    limit: "1",
  });
  const adminResponse = await fetch(`${supabaseUrl}/rest/v1/admin_users?${query}`, {
    headers: serviceHeaders(serviceKey),
  });
  const rows = await adminResponse.json().catch(() => null) as Array<{ user_id: string; role: string; is_active: boolean }> | null;
  if (!adminResponse.ok || !Array.isArray(rows) || rows.length !== 1) return { status: 403 };
  const row = rows[0];
  if (!row.is_active || !roles.has(row.role)) return { status: 403 };
  return { admin: { userId: user.id, role: row.role as AdminRole } };
};

const getAuthUser = async (supabaseUrl: string, serviceKey: string, userId: string) => {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    headers: serviceHeaders(serviceKey),
  });
  if (!response.ok) return null;
  return await response.json().catch(() => null) as AuthUser | null;
};

const sendPasswordRecovery = async (supabaseUrl: string, serviceKey: string, email: string, redirectTo: string) => {
  const recoveryUrl = new URL(`${supabaseUrl}/auth/v1/recover`);
  recoveryUrl.searchParams.set("redirect_to", redirectTo);
  const response = await fetch(recoveryUrl, {
    method: "POST",
    headers: serviceHeaders(serviceKey),
    body: JSON.stringify({ email }),
  });
  if (!response.ok) {
    const details = await response.json().catch(() => null) as {
      code?: string | number;
      error_code?: string | number;
      msg?: string;
      message?: string;
      error_description?: string;
    } | null;
    console.error("admin-users recovery diagnostic", {
      action: "send_access_recovery",
      status: response.status,
      code: details?.code ?? details?.error_code,
      error: details?.msg ?? details?.message ?? details?.error_description,
    });
  }
  return response.ok;
};

const generateAccessLink = async (supabaseUrl: string, serviceKey: string, email: string, redirectTo: string) => {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: serviceHeaders(serviceKey),
    body: JSON.stringify({
      type: "recovery",
      email,
      redirect_to: redirectTo,
    }),
  });
  const data = await response.json().catch(() => null) as {
    action_link?: string;
    code?: string | number;
    error_code?: string | number;
    msg?: string;
    message?: string;
  } | null;
  if (!response.ok || typeof data?.action_link !== "string" || !data.action_link) {
    throw new Error(data?.msg || data?.message || `Auth generate_link failed (${response.status})`);
  }
  return data.action_link;
};

const findAuthUserByEmail = async (supabaseUrl: string, serviceKey: string, email: string) => {
  for (let page = 1; page <= 10; page += 1) {
    const response = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=1000`, {
      headers: serviceHeaders(serviceKey),
    });
    if (!response.ok) throw new Error("AUTH_LIST_FAILED");
    const data = await response.json().catch(() => null) as { users?: AuthUser[] } | AuthUser[] | null;
    const users = Array.isArray(data) ? data : data?.users;
    if (!Array.isArray(users)) throw new Error("AUTH_LIST_FAILED");
    const match = users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match;
    if (users.length < 1000) return null;
  }
  throw new Error("AUTH_LIST_FAILED");
};

const presentAdmin = (row: AdminRow, email: string) => ({
  user_id: row.user_id,
  email,
  role: row.role,
  is_active: row.is_active,
  created_at: row.created_at,
});

const adminSiteRedirect = (configuredOrigin: string | undefined) => {
  if (!configuredOrigin) return null;
  try {
    const origin = new URL(configuredOrigin.trim());
    const localHttp = origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname);
    if ((origin.protocol !== "https:" && !localHttp) || origin.username || origin.password) return null;
    return `${origin.origin}/admin/`;
  } catch {
    return null;
  }
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders });
  if (!["GET", "POST", "PATCH"].includes(request.method)) return fail(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return fail(500, "SERVER_ERROR", "Konfigurasi server belum lengkap.");
  const adminRedirectTo = adminSiteRedirect(Deno.env.get("ADMIN_SITE_ORIGIN"));

  const authorization = await authorize(request, supabaseUrl, anonKey, serviceKey);
  if (!authorization.admin) {
    const status = authorization.status === 401 ? 401 : 403;
    return fail(status, status === 401 ? "UNAUTHORIZED" : "FORBIDDEN", status === 401
      ? "Sesi admin tidak valid."
      : "Akun ini tidak aktif atau tidak memiliki akses admin.");
  }
  if (authorization.admin.role !== "super_admin") {
    return fail(403, "SUPER_ADMIN_REQUIRED", "Kelola Admin hanya dapat diakses oleh Super Admin.");
  }

  if (request.method === "GET") {
    const query = new URLSearchParams({ select: adminProjection, order: "created_at.asc" });
    const response = await fetch(`${supabaseUrl}/rest/v1/admin_users?${query}`, { headers: serviceHeaders(serviceKey) });
    const rows = await response.json().catch(() => null) as AdminRow[] | null;
    if (!response.ok || !Array.isArray(rows)) return fail(500, "SERVER_ERROR", "Daftar admin belum dapat dimuat.");

    const users = await Promise.all(rows.map((row) => getAuthUser(supabaseUrl, serviceKey, row.user_id)));
    if (users.some((user) => !user?.email)) return fail(500, "SERVER_ERROR", "Email admin belum dapat dimuat.");
    return json(200, { admins: rows.map((row, index) => presentAdmin(row, users[index]!.email!)) });
  }

  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload || Array.isArray(payload)) return fail(400, "INVALID_REQUEST", "Data admin tidak valid.");

  if (request.method === "PATCH" && payload.action === "send_access_recovery") {
    const unknown = Object.keys(payload).filter((key) => !["action", "user_id"].includes(key));
    const userId = typeof payload.user_id === "string" ? payload.user_id.trim() : "";
    if (unknown.length || !uuidPattern.test(userId)) return fail(400, "INVALID_ADMIN", "Admin yang akan diubah tidak valid.");

    const targetQuery = new URLSearchParams({ select: adminProjection, user_id: `eq.${userId}`, limit: "1" });
    const targetResponse = await fetch(`${supabaseUrl}/rest/v1/admin_users?${targetQuery}`, { headers: serviceHeaders(serviceKey) });
    const targetRows = await targetResponse.json().catch(() => null) as AdminRow[] | null;
    if (!targetResponse.ok || !Array.isArray(targetRows)) return fail(500, "SERVER_ERROR", "Status admin belum dapat diperiksa.");
    if (targetRows.length !== 1) return fail(404, "ADMIN_NOT_FOUND", "Admin tidak ditemukan.");

    const targetUser = await getAuthUser(supabaseUrl, serviceKey, userId);
    if (!targetUser?.email) return fail(404, "ADMIN_NOT_FOUND", "Admin tidak ditemukan.");
    if (!adminRedirectTo) return fail(500, "SERVER_CONFIG", "Tujuan akses admin belum dikonfigurasi.");
    try {
      if (!await sendPasswordRecovery(supabaseUrl, serviceKey, targetUser.email, adminRedirectTo)) {
        return fail(500, "RECOVERY_FAILED", "Email akses baru belum dapat dikirim.");
      }
    } catch (error) {
      const details = error as { code?: string | number; status?: string | number };
      console.error("admin-users recovery diagnostic", {
        action: "send_access_recovery",
        status: details?.status,
        code: details?.code,
        error: error instanceof Error ? error.message : String(error),
      });
      return fail(500, "RECOVERY_FAILED", "Email akses baru belum dapat dikirim.");
    }
    return json(200, { message: "Email akses baru sudah dikirim." });
  }

  if (request.method === "PATCH" && payload.action === "generate_access_link") {
    const unknown = Object.keys(payload).filter((key) => !["action", "user_id"].includes(key));
    const userId = typeof payload.user_id === "string" ? payload.user_id.trim() : "";
    if (unknown.length || !uuidPattern.test(userId)) return fail(400, "INVALID_ADMIN", "Admin yang akan diubah tidak valid.");

    const targetQuery = new URLSearchParams({ select: adminProjection, user_id: `eq.${userId}`, limit: "1" });
    const targetResponse = await fetch(`${supabaseUrl}/rest/v1/admin_users?${targetQuery}`, { headers: serviceHeaders(serviceKey) });
    const targetRows = await targetResponse.json().catch(() => null) as AdminRow[] | null;
    if (!targetResponse.ok || !Array.isArray(targetRows)) return fail(500, "SERVER_ERROR", "Status admin belum dapat diperiksa.");
    if (targetRows.length !== 1) return fail(404, "ADMIN_NOT_FOUND", "Admin tidak ditemukan.");

    const targetUser = await getAuthUser(supabaseUrl, serviceKey, userId);
    if (!targetUser?.email) return fail(404, "ADMIN_NOT_FOUND", "Admin tidak ditemukan.");
    if (!adminRedirectTo) return fail(500, "SERVER_CONFIG", "Tujuan akses admin belum dikonfigurasi.");
    try {
      const actionLink = await generateAccessLink(supabaseUrl, serviceKey, targetUser.email, adminRedirectTo);
      return json(200, { action_link: actionLink });
    } catch {
      return fail(500, "RECOVERY_FAILED", "Tautan akses belum dapat dibuat.");
    }
  }

  if (request.method === "POST") {
    const unknown = Object.keys(payload).filter((key) => !["email", "role"].includes(key));
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    const role = payload.role;
    if (unknown.length || !emailPattern.test(email) || email.length > 254) return fail(400, "INVALID_EMAIL", "Email admin tidak valid.");
    if (typeof role !== "string" || !roles.has(role)) return fail(400, "INVALID_ROLE", "Peran admin tidak valid.");
    if (!adminRedirectTo) return fail(500, "SERVER_CONFIG", "Tujuan undangan admin belum dikonfigurasi.");

    let existingUser: AuthUser | null;
    try { existingUser = await findAuthUserByEmail(supabaseUrl, serviceKey, email); }
    catch { return fail(500, "SERVER_ERROR", "Status akun belum dapat diperiksa."); }
    if (existingUser) {
      const existingQuery = new URLSearchParams({ select: adminProjection, user_id: `eq.${existingUser.id}`, limit: "1" });
      const existingResponse = await fetch(`${supabaseUrl}/rest/v1/admin_users?${existingQuery}`, { headers: serviceHeaders(serviceKey) });
      const existingRows = await existingResponse.json().catch(() => null) as AdminRow[] | null;
      if (!existingResponse.ok || !Array.isArray(existingRows)) return fail(500, "SERVER_ERROR", "Status admin belum dapat diperiksa.");
      if (existingRows[0]?.is_active) return fail(409, "ADMIN_EXISTS", "Email ini sudah menjadi admin aktif.");
      if (existingRows[0]) return fail(409, "ADMIN_INACTIVE", "Email ini sudah terdaftar dan sedang dinonaktifkan. Aktifkan kembali dari daftar admin.");
      return fail(409, "AUTH_USER_EXISTS", "Email ini sudah memiliki akun. Hubungi pengelola sistem sebelum memberikan akses admin.");
    }

    const inviteUrl = new URL(`${supabaseUrl}/auth/v1/invite`);
    inviteUrl.searchParams.set("redirect_to", adminRedirectTo);
    const inviteResponse = await fetch(inviteUrl, {
      method: "POST",
      headers: serviceHeaders(serviceKey),
      body: JSON.stringify({ email }),
    });
    const invitedUser = await inviteResponse.json().catch(() => null) as AuthUser | { msg?: string; message?: string } | null;
    if (!inviteResponse.ok || !invitedUser || !("id" in invitedUser) || !invitedUser.id) {
      const message = invitedUser && ("msg" in invitedUser || "message" in invitedUser)
        ? ("msg" in invitedUser ? invitedUser.msg : invitedUser.message)
        : null;
      return fail(inviteResponse.status === 429 ? 429 : 400, "INVITE_FAILED", message || "Undangan admin belum dapat dikirim.");
    }

    const row: AdminRow = {
      user_id: invitedUser.id,
      role: role as AdminRole,
      is_active: true,
      created_at: new Date().toISOString(),
    };
    const insertResponse = await fetch(`${supabaseUrl}/rest/v1/admin_users?select=${encodeURIComponent(adminProjection)}`, {
      method: "POST",
      headers: serviceHeaders(serviceKey, "return=representation"),
      body: JSON.stringify({ user_id: row.user_id, role: row.role, is_active: true }),
    });
    const inserted = await insertResponse.json().catch(() => null) as AdminRow[] | null;
    if (!insertResponse.ok || !Array.isArray(inserted) || inserted.length !== 1) {
      return fail(500, "ALLOWLIST_FAILED", "Undangan terkirim, tetapi akses admin belum tercatat. Perlu pemeriksaan manual sebelum mengirim ulang.");
    }
    return json(201, { admins: [presentAdmin(inserted[0], email)] });
  }

  const unknown = Object.keys(payload).filter((key) => !["user_id", "role", "is_active"].includes(key));
  const userId = typeof payload.user_id === "string" ? payload.user_id.trim() : "";
  const role = payload.role;
  const isActive = payload.is_active;
  if (unknown.length || !uuidPattern.test(userId)) return fail(400, "INVALID_ADMIN", "Admin yang akan diubah tidak valid.");
  if (role !== undefined && (typeof role !== "string" || !roles.has(role))) return fail(400, "INVALID_ROLE", "Peran admin tidak valid.");
  if (isActive !== undefined && typeof isActive !== "boolean") return fail(400, "INVALID_STATE", "Status admin tidak valid.");
  if (role === undefined && isActive === undefined) return fail(400, "NO_CHANGES", "Tidak ada perubahan untuk disimpan.");

  const rpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/update_admin_user_safely`, {
    method: "POST",
    headers: serviceHeaders(serviceKey),
    body: JSON.stringify({
      p_actor_user_id: authorization.admin.userId,
      p_target_user_id: userId,
      p_role: role ?? null,
      p_is_active: isActive ?? null,
    }),
  });
  const updated = await rpcResponse.json().catch(() => null) as AdminRow[] | { message?: string } | null;
  if (!rpcResponse.ok || !Array.isArray(updated) || updated.length !== 1) {
    const marker = !Array.isArray(updated) ? updated?.message : "";
    if (marker?.includes("SELF_DEACTIVATE")) return fail(409, "SELF_DEACTIVATE", "Kamu tidak dapat menonaktifkan akun sendiri.");
    if (marker?.includes("LAST_SUPER_ADMIN")) return fail(409, "LAST_SUPER_ADMIN", "Super Admin aktif terakhir tidak dapat diturunkan perannya atau dinonaktifkan.");
    if (marker?.includes("ADMIN_NOT_FOUND")) return fail(404, "ADMIN_NOT_FOUND", "Admin tidak ditemukan.");
    if (marker?.includes("ADMIN_FORBIDDEN")) return fail(403, "FORBIDDEN", "Akses Super Admin tidak lagi aktif.");
    return fail(500, "SERVER_ERROR", "Perubahan admin belum dapat disimpan.");
  }

  const user = await getAuthUser(supabaseUrl, serviceKey, updated[0].user_id);
  if (!user?.email) return fail(500, "SERVER_ERROR", "Email admin belum dapat dimuat.");
  return json(200, { admins: [presentAdmin(updated[0], user.email)] });
});
