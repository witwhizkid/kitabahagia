// Admin certificates. Stage 2: the signer list (certificate_signers + the private
// certificate-signatures bucket). Later stages add per-event settings and issuing here.
//   GET                 list signers, with 10-minute signed URLs for the previews
//   POST (multipart)    add a signer: name, role, title, organization, consent,
//                       signature (PNG), stamp (PNG, founder only)
//   PATCH ?id=<uuid>    edit name / title / organization, or is_active
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
  json(status, { signers: [], error: { code, message } });

const BUCKET = "certificate-signatures";
const MAX_IMAGE_BYTES = 1024 * 1024;
const MAX_MULTIPART_BYTES = 2 * MAX_IMAGE_BYTES + 64 * 1024;
const SIGNED_URL_SECONDS = 600;
const roles = new Set(["founder", "project_leader", "partner"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const signerProjection = "id,name,role,title,organization,signature_path,stamp_path,is_active,consent_confirmed_at,created_by,created_at,updated_at";

const serviceHeaders = (key: string, extra: Record<string, string> = {}) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  Accept: "application/json",
  ...extra,
});

// Returns the active admin's email (kept on the signer as "created_by"), or null.
const authorize = async (request: Request, supabaseUrl: string, anonKey: string, serviceKey: string) => {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  if (!userResponse.ok) return null;
  const user = await userResponse.json().catch(() => null) as { id?: string; email?: string } | null;
  if (!user?.id) return null;
  const query = new URLSearchParams({
    select: "user_id",
    user_id: `eq.${user.id}`,
    is_active: "eq.true",
    role: "in.(admin,super_admin)",
    limit: "1",
  });
  const adminResponse = await fetch(`${supabaseUrl}/rest/v1/admin_users?${query}`, { headers: serviceHeaders(serviceKey) });
  const rows = await adminResponse.json().catch(() => null);
  if (!adminResponse.ok || !Array.isArray(rows) || rows.length !== 1) return null;
  return user.email || user.id;
};

// Text fields: trimmed, 2-120 characters, no control characters.
const cleanText = (value: unknown) => {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ");
  return text.length >= 2 && text.length <= 120 && !/[\x00-\x1f\x7f<>]/.test(text) ? text : null;
};

const isPng = (bytes: Uint8Array) => bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50
  && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;

const readPng = async (value: FormDataEntryValue | null) => {
  if (!(value instanceof File) || value.size < 1 || value.size > MAX_IMAGE_BYTES || value.type !== "image/png") return null;
  const bytes = new Uint8Array(await value.arrayBuffer());
  return isPng(bytes) ? bytes : null;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders });
  if (!["GET", "POST", "PATCH"].includes(request.method)) return fail(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return fail(500, "SERVER_ERROR", "Konfigurasi server belum lengkap.");
  const adminEmail = await authorize(request, supabaseUrl, anonKey, serviceKey);
  if (!adminEmail) return fail(401, "UNAUTHORIZED", "Sesi admin tidak valid atau akses tidak diizinkan.");

  const objectUrl = (path: string) => `${supabaseUrl}/storage/v1/object/${BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const signObject = async (path: unknown) => {
    if (typeof path !== "string" || !path) return null;
    const response = await fetch(`${supabaseUrl}/storage/v1/object/sign/${BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`, {
      method: "POST",
      headers: serviceHeaders(serviceKey, { "Content-Type": "application/json" }),
      body: JSON.stringify({ expiresIn: SIGNED_URL_SECONDS }),
    });
    const result = await response.json().catch(() => null) as { signedURL?: string; signedUrl?: string } | null;
    const signedPath = result?.signedURL || result?.signedUrl;
    if (!response.ok || typeof signedPath !== "string") return null;
    // Storage answers "/object/sign/..." relative to /storage/v1 (as supabase-js assumes).
    const signedUrl = new URL(signedPath.startsWith("/object/") ? `${supabaseUrl}/storage/v1${signedPath}` : signedPath, supabaseUrl);
    return signedUrl.origin === new URL(supabaseUrl).origin && signedUrl.pathname.startsWith("/storage/v1/object/sign/")
      ? signedUrl.href : null;
  };
  const listSigners = async () => {
    const query = new URLSearchParams({ select: signerProjection, order: "is_active.desc,role.asc,name.asc" });
    const response = await fetch(`${supabaseUrl}/rest/v1/certificate_signers?${query}`, { headers: serviceHeaders(serviceKey) });
    const rows = await response.json().catch(() => null) as Array<Record<string, unknown>> | null;
    if (!response.ok || !Array.isArray(rows)) return null;
    return await Promise.all(rows.map(async ({ signature_path, stamp_path, ...signer }) => ({
      ...signer,
      signature_url: await signObject(signature_path),
      stamp_url: await signObject(stamp_path),
    })));
  };

  if (request.method === "GET") {
    const signers = await listSigners();
    return signers ? json(200, { signers }) : fail(500, "SERVER_ERROR", "Daftar tanda tangan belum dapat dimuat.");
  }

  if (request.method === "PATCH") {
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!uuidPattern.test(id)) return fail(400, "INVALID_REQUEST", "Penanda tangan tidak valid.");
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body) || !Object.keys(body).length
      || Object.keys(body).some((key) => !["name", "title", "organization", "is_active"].includes(key))) {
      return fail(400, "INVALID_REQUEST", "Perubahan tidak valid.");
    }
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if ("is_active" in body) {
      if (typeof body.is_active !== "boolean") return fail(400, "INVALID_REQUEST", "Status tidak valid.");
      update.is_active = body.is_active;
    }
    for (const key of ["name", "title"]) {
      if (!(key in body)) continue;
      const text = cleanText(body[key]);
      if (!text) return fail(400, "INVALID_REQUEST", key === "name" ? "Nama harus 2–120 karakter." : "Jabatan harus 2–120 karakter.");
      update[key] = text;
    }
    if ("organization" in body) {
      const organization = body.organization === null || body.organization === "" ? null : cleanText(body.organization);
      if (organization === null && body.organization !== null && body.organization !== "") {
        return fail(400, "INVALID_REQUEST", "Nama organisasi harus 2–120 karakter.");
      }
      update.organization = organization;
    }
    const query = new URLSearchParams({ id: `eq.${id}`, select: "id" });
    const response = await fetch(`${supabaseUrl}/rest/v1/certificate_signers?${query}`, {
      method: "PATCH",
      headers: serviceHeaders(serviceKey, { "Content-Type": "application/json", Prefer: "return=representation" }),
      body: JSON.stringify(update),
    });
    const rows = await response.json().catch(() => null);
    if (response.status === 400) return fail(400, "INVALID_REQUEST", "Mitra harus punya nama organisasi.");
    if (!response.ok || !Array.isArray(rows)) return fail(500, "SERVER_ERROR", "Perubahan belum dapat disimpan.");
    if (!rows.length) return fail(404, "NOT_FOUND", "Penanda tangan tidak ditemukan.");
    const signers = await listSigners();
    // null = saved, but the refreshed list failed; the admin page reloads it.
    return json(200, { signers });
  }

  // POST: add a signer. The browser already removed the paper background and sends PNGs.
  const contentType = request.headers.get("content-type") || "";
  const declaredLength = Number(request.headers.get("content-length"));
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")
    || (Number.isFinite(declaredLength) && declaredLength > MAX_MULTIPART_BYTES)) {
    return fail(400, "INVALID_REQUEST", "Data tanda tangan tidak valid.");
  }
  let form: FormData;
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > MAX_MULTIPART_BYTES) return fail(413, "FILE_TOO_LARGE", "Gambar tanda tangan maksimal 1 MB.");
    form = await new Request(request.url, { method: "POST", headers: { "content-type": contentType }, body: bytes }).formData();
  } catch {
    return fail(400, "INVALID_REQUEST", "Data tanda tangan tidak valid.");
  }
  const allowedKeys = new Set(["name", "role", "title", "organization", "consent", "signature", "stamp"]);
  const keys = [...form.keys()];
  if (keys.some((key) => !allowedKeys.has(key)) || new Set(keys).size !== keys.length) {
    return fail(400, "INVALID_REQUEST", "Data tanda tangan tidak valid.");
  }
  const role = form.get("role");
  const name = cleanText(form.get("name"));
  const title = cleanText(form.get("title"));
  const organizationValue = form.get("organization");
  const organization = typeof organizationValue === "string" && organizationValue.trim() ? cleanText(organizationValue) : null;
  if (typeof role !== "string" || !roles.has(role)) return fail(400, "INVALID_REQUEST", "Peran tidak valid.");
  if (!name) return fail(400, "INVALID_REQUEST", "Nama harus 2–120 karakter.");
  if (!title) return fail(400, "INVALID_REQUEST", "Jabatan harus 2–120 karakter.");
  if (typeof organizationValue === "string" && organizationValue.trim() && !organization) {
    return fail(400, "INVALID_REQUEST", "Nama organisasi harus 2–120 karakter.");
  }
  if (role === "partner" && !organization) return fail(400, "INVALID_REQUEST", "Mitra harus punya nama organisasi.");
  if (form.get("consent") !== "true") return fail(400, "CONSENT_REQUIRED", "Centang izin dari pemilik tanda tangan.");
  const signature = await readPng(form.get("signature"));
  if (!signature) return fail(400, "INVALID_IMAGE", "Gambar tanda tangan harus PNG, maksimal 1 MB.");
  const stampEntry = form.get("stamp");
  const stamp = stampEntry ? await readPng(stampEntry) : null;
  if (stampEntry && !stamp) return fail(400, "INVALID_IMAGE", "Gambar stempel harus PNG, maksimal 1 MB.");
  if (stamp && role !== "founder") return fail(400, "INVALID_REQUEST", "Stempel hanya untuk Founder.");

  const id = crypto.randomUUID();
  const uploaded: string[] = [];
  const removeUploaded = async () => {
    if (!uploaded.length) return;
    await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}`, {
      method: "DELETE",
      headers: serviceHeaders(serviceKey, { "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: uploaded }),
    }).catch(() => undefined);
  };
  const upload = async (path: string, bytes: Uint8Array) => {
    const response = await fetch(objectUrl(path), {
      method: "POST",
      headers: serviceHeaders(serviceKey, { "Content-Type": "image/png", "x-upsert": "false" }),
      body: bytes,
    });
    if (response.ok) uploaded.push(path);
    return response.ok;
  };

  const signaturePath = `${id}/signature.png`;
  const stampPath = stamp ? `${id}/stamp.png` : null;
  if (!await upload(signaturePath, signature) || (stamp && stampPath && !await upload(stampPath, stamp))) {
    await removeUploaded();
    return fail(500, "SERVER_ERROR", "Gambar tanda tangan belum dapat disimpan.");
  }
  const insertResponse = await fetch(`${supabaseUrl}/rest/v1/certificate_signers`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, { "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify({
      id, name, role, title, organization,
      signature_path: signaturePath, stamp_path: stampPath,
      consent_confirmed_at: new Date().toISOString(), created_by: adminEmail,
    }),
  });
  if (!insertResponse.ok) {
    await removeUploaded();
    return fail(500, "SERVER_ERROR", "Tanda tangan belum dapat disimpan.");
  }
  const signers = await listSigners();
  return json(201, { signers });
});
