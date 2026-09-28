// Admin certificates. Stage 2: the signer list (certificate_signers + the private
// certificate-signatures bucket). Stage 3: per-event settings (event_certificates +
// the private certificate-assets bucket). Issuing comes later.
//   GET                 list signers, with 10-minute signed URLs for the previews
//   POST (multipart)    add a signer: name, role, title, organization, consent,
//                       signature (PNG), stamp (PNG, founder only)
//   PATCH ?id=<uuid>    edit name / title / organization, or is_active
//   DELETE ?id=<uuid>   delete a deactivated signer that no event's settings still use
//                       (row + images); certificates already issued keep their PDF
//   GET ?event=<slug>   the event's settings (null before the first save) + signers
//   POST ?event=<slug>  (multipart) save settings; optional ornament / partner_logo
//                       PNGs, remove_ornament / remove_partner_logo = "true"
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
  json(status, { signers: [], error: { code, message } });

const BUCKET = "certificate-signatures";
const ASSET_BUCKET = "certificate-assets";
const MAX_IMAGE_BYTES = 1024 * 1024;
const MAX_ASSET_BYTES = 2 * 1024 * 1024;
const MAX_MULTIPART_BYTES = 2 * MAX_IMAGE_BYTES + 64 * 1024;
const MAX_SETTINGS_BYTES = 2 * MAX_ASSET_BYTES + 64 * 1024;
const SIGNED_URL_SECONDS = 600;
const roles = new Set(["founder", "project_leader", "partner"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const signerProjection = "id,name,role,title,organization,signature_path,stamp_path,is_active,consent_confirmed_at,created_by,created_at,updated_at";
const settingsProjection = "certificate_number,description,ornament_preset,ornament_color,ornament_path,logo_variant,founder_id,project_leader_id,partner_signer_id,partner_logo_path,updated_by,updated_at";
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const numberPattern = /^[0-9A-Za-z][0-9A-Za-z./ -]{0,39}$/;
const ornamentPresets = new Set(["kelopak", "balok"]);
const ornamentColors = new Set(["maroon", "emas", "hijau", "biru"]);
const logoVariants = new Set(["color", "white"]);
const signerFields = { founder_id: "founder", project_leader_id: "project_leader", partner_signer_id: "partner" } as const;

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

const readPng = async (value: FormDataEntryValue | null, maxBytes = MAX_IMAGE_BYTES) => {
  if (!(value instanceof File) || value.size < 1 || value.size > maxBytes || value.type !== "image/png") return null;
  const bytes = new Uint8Array(await value.arrayBuffer());
  return isPng(bytes) ? bytes : null;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders });
  if (!["GET", "POST", "PATCH", "DELETE"].includes(request.method)) return fail(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return fail(500, "SERVER_ERROR", "Konfigurasi server belum lengkap.");
  const adminEmail = await authorize(request, supabaseUrl, anonKey, serviceKey);
  if (!adminEmail) return fail(401, "UNAUTHORIZED", "Sesi admin tidak valid atau akses tidak diizinkan.");

  const objectUrl = (path: string, bucket = BUCKET) => `${supabaseUrl}/storage/v1/object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const signObject = async (path: unknown, bucket = BUCKET) => {
    if (typeof path !== "string" || !path) return null;
    const response = await fetch(`${supabaseUrl}/storage/v1/object/sign/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`, {
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

  const removeObjects = async (paths: string[], bucket: string) => {
    if (!paths.length) return;
    await fetch(`${supabaseUrl}/storage/v1/object/${bucket}`, {
      method: "DELETE",
      headers: serviceHeaders(serviceKey, { "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: paths }),
    }).catch(() => undefined);
  };
  const uploadPng = async (path: string, bytes: Uint8Array, bucket: string) => {
    const response = await fetch(objectUrl(path, bucket), {
      method: "POST",
      headers: serviceHeaders(serviceKey, { "Content-Type": "image/png", "x-upsert": "false" }),
      body: bytes,
    });
    return response.ok;
  };
  const readForm = async (maxBytes: number) => {
    const contentType = request.headers.get("content-type") || "";
    const declaredLength = Number(request.headers.get("content-length"));
    if (!contentType.toLowerCase().startsWith("multipart/form-data;")
      || (Number.isFinite(declaredLength) && declaredLength > maxBytes)) return null;
    try {
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.byteLength > maxBytes) return null;
      return await new Request(request.url, { method: "POST", headers: { "content-type": contentType }, body: bytes }).formData();
    } catch {
      return null;
    }
  };

  const eventSlug = new URL(request.url).searchParams.get("event");
  if (eventSlug !== null) {
    if (!["GET", "POST"].includes(request.method) || eventSlug.length > 120 || !slugPattern.test(eventSlug)) {
      return fail(400, "INVALID_REQUEST", "Kegiatan tidak valid.");
    }
    const eventResponse = await fetch(
      `${supabaseUrl}/rest/v1/events?${new URLSearchParams({ slug: `eq.${eventSlug}`, select: "id", limit: "1" })}`,
      { headers: serviceHeaders(serviceKey) },
    );
    const eventRows = await eventResponse.json().catch(() => null) as Array<{ id: string }> | null;
    if (!eventResponse.ok || !Array.isArray(eventRows)) return fail(500, "SERVER_ERROR", "Kegiatan belum dapat dimuat.");
    if (!eventRows.length) return fail(404, "NOT_FOUND", "Kegiatan tidak ditemukan.");
    const eventId = eventRows[0].id;
    const readSettings = async () => {
      const response = await fetch(
        `${supabaseUrl}/rest/v1/event_certificates?${new URLSearchParams({ event_id: `eq.${eventId}`, select: settingsProjection })}`,
        { headers: serviceHeaders(serviceKey) },
      );
      const rows = await response.json().catch(() => null) as Array<Record<string, unknown>> | null;
      return response.ok && Array.isArray(rows) ? { row: rows[0] || null } : null;
    };
    const settingsResponse = async (status: number) => {
      const [current, signers] = await Promise.all([readSettings(), listSigners()]);
      if (!current || !signers) return fail(500, "SERVER_ERROR", "Pengaturan sertifikat belum dapat dimuat.");
      if (!current.row) return json(status, { settings: null, signers });
      const { ornament_path, partner_logo_path, ...settings } = current.row;
      return json(status, {
        settings: {
          ...settings,
          ornament_url: await signObject(ornament_path, ASSET_BUCKET),
          partner_logo_url: await signObject(partner_logo_path, ASSET_BUCKET),
        },
        signers,
      });
    };
    if (request.method === "GET") return await settingsResponse(200);

    const form = await readForm(MAX_SETTINGS_BYTES);
    if (!form) return fail(400, "INVALID_REQUEST", "Data pengaturan tidak valid atau gambar terlalu besar.");
    const allowedKeys = new Set(["certificate_number", "description", "ornament_preset", "ornament_color", "logo_variant",
      "founder_id", "project_leader_id", "partner_signer_id", "ornament", "partner_logo", "remove_ornament", "remove_partner_logo"]);
    const keys = [...form.keys()];
    if (keys.some((key) => !allowedKeys.has(key)) || new Set(keys).size !== keys.length) {
      return fail(400, "INVALID_REQUEST", "Data pengaturan tidak valid.");
    }
    const text = (key: string) => {
      const value = form.get(key);
      return typeof value === "string" ? value : value === null ? "" : null;
    };
    const numberText = text("certificate_number")?.trim().replace(/\s+/g, " ");
    if (numberText === undefined || (numberText && !numberPattern.test(numberText))) {
      return fail(400, "INVALID_REQUEST", "Nomor sertifikat hanya boleh huruf, angka, titik, garis miring, strip, dan spasi (maks. 40).");
    }
    const descriptionText = text("description")?.replace(/\r\n?/g, "\n").trim();
    if (descriptionText === undefined || descriptionText.length > 500 || /[\x00-\x09\x0b-\x1f\x7f<>]/.test(descriptionText)) {
      return fail(400, "INVALID_REQUEST", "Deskripsi maksimal 500 karakter, tanpa tanda < atau >.");
    }
    const preset = text("ornament_preset");
    const color = text("ornament_color");
    const variant = text("logo_variant");
    if (!preset || !ornamentPresets.has(preset) || !color || !ornamentColors.has(color) || !variant || !logoVariants.has(variant)) {
      return fail(400, "INVALID_REQUEST", "Pilihan ornamen atau logo tidak valid.");
    }
    const current = await readSettings();
    if (!current) return fail(500, "SERVER_ERROR", "Pengaturan sertifikat belum dapat dimuat.");
    const previous = current.row || {};
    const signerIds: Record<string, string | null> = {};
    for (const field of Object.keys(signerFields)) {
      const value = text(field);
      if (value === null || (value && !uuidPattern.test(value))) return fail(400, "INVALID_REQUEST", "Penanda tangan tidak valid.");
      signerIds[field] = value || null;
    }
    const chosen = [...new Set(Object.values(signerIds).filter(Boolean))] as string[];
    if (chosen.length) {
      const response = await fetch(
        `${supabaseUrl}/rest/v1/certificate_signers?${new URLSearchParams({ id: `in.(${chosen.join(",")})`, select: "id,role,is_active" })}`,
        { headers: serviceHeaders(serviceKey) },
      );
      const rows = await response.json().catch(() => null) as Array<{ id: string; role: string; is_active: boolean }> | null;
      if (!response.ok || !Array.isArray(rows)) return fail(500, "SERVER_ERROR", "Penanda tangan belum dapat diperiksa.");
      for (const [field, role] of Object.entries(signerFields)) {
        const id = signerIds[field];
        if (!id) continue;
        const signer = rows.find((row) => row.id === id);
        // An inactive signer may stay on the event it was already chosen for, but not be newly picked.
        if (!signer || signer.role !== role || (!signer.is_active && previous[field] !== id)) {
          return fail(400, "INVALID_SIGNER", "Penanda tangan tidak cocok dengan perannya atau sudah dinonaktifkan.");
        }
      }
    }
    const ornamentEntry = form.get("ornament");
    const logoEntry = form.get("partner_logo");
    const ornament = ornamentEntry ? await readPng(ornamentEntry, MAX_ASSET_BYTES) : null;
    const partnerLogo = logoEntry ? await readPng(logoEntry, MAX_ASSET_BYTES) : null;
    if ((ornamentEntry && !ornament) || (logoEntry && !partnerLogo)) {
      return fail(400, "INVALID_IMAGE", "Gambar ornamen/logo harus PNG, maksimal 2 MB.");
    }
    for (const key of ["remove_ornament", "remove_partner_logo"]) {
      const value = form.get(key);
      if (value !== null && value !== "true") return fail(400, "INVALID_REQUEST", "Data pengaturan tidak valid.");
    }
    const uploaded: string[] = [];
    const paths: Record<string, string | null> = {
      ornament_path: typeof previous.ornament_path === "string" ? previous.ornament_path : null,
      partner_logo_path: typeof previous.partner_logo_path === "string" ? previous.partner_logo_path : null,
    };
    const replaced: string[] = [];
    for (const [field, bytes, removeKey, name] of [
      ["ornament_path", ornament, "remove_ornament", "ornament"],
      ["partner_logo_path", partnerLogo, "remove_partner_logo", "partner-logo"],
    ] as const) {
      if (!bytes && form.get(removeKey) !== "true") continue;
      if (paths[field]) replaced.push(paths[field]!);
      paths[field] = null;
      if (!bytes) continue;
      // New object name per upload, so a failed save never overwrites the saved image.
      const path = `${eventId}/${name}-${crypto.randomUUID()}.png`;
      if (!await uploadPng(path, bytes, ASSET_BUCKET)) {
        await removeObjects(uploaded, ASSET_BUCKET);
        return fail(500, "SERVER_ERROR", "Gambar belum dapat disimpan.");
      }
      uploaded.push(path);
      paths[field] = path;
    }
    const saveResponse = await fetch(`${supabaseUrl}/rest/v1/event_certificates?on_conflict=event_id`, {
      method: "POST",
      headers: serviceHeaders(serviceKey, { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({
        event_id: eventId,
        certificate_number: numberText || null,
        description: descriptionText || null,
        ornament_preset: preset,
        ornament_color: color,
        logo_variant: variant,
        ...signerIds,
        ...paths,
        updated_by: adminEmail,
        updated_at: new Date().toISOString(),
      }),
    });
    if (!saveResponse.ok) {
      await removeObjects(uploaded, ASSET_BUCKET);
      return fail(500, "SERVER_ERROR", "Pengaturan sertifikat belum dapat disimpan.");
    }
    await removeObjects(replaced, ASSET_BUCKET);
    return await settingsResponse(200);
  }

  if (request.method === "GET") {
    const signers = await listSigners();
    return signers ? json(200, { signers }) : fail(500, "SERVER_ERROR", "Daftar tanda tangan belum dapat dimuat.");
  }

  if (request.method === "DELETE") {
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!uuidPattern.test(id)) return fail(400, "INVALID_REQUEST", "Penanda tangan tidak valid.");
    const found = await fetch(`${supabaseUrl}/rest/v1/certificate_signers?${new URLSearchParams({
      id: `eq.${id}`, select: "id,is_active,signature_path,stamp_path",
    })}`, { headers: serviceHeaders(serviceKey) });
    const signerRows = await found.json().catch(() => null) as Array<{ is_active: boolean; signature_path: string; stamp_path: string | null }> | null;
    if (!found.ok || !Array.isArray(signerRows)) return fail(500, "SERVER_ERROR", "Penanda tangan belum dapat diperiksa.");
    const signer = signerRows[0];
    if (!signer) return fail(404, "NOT_FOUND", "Penanda tangan tidak ditemukan.");
    if (signer.is_active) return fail(409, "SIGNER_ACTIVE", "Nonaktifkan dulu tanda tangan ini sebelum menghapusnya.");
    const used = await fetch(`${supabaseUrl}/rest/v1/event_certificates?${new URLSearchParams({
      or: `(founder_id.eq.${id},project_leader_id.eq.${id},partner_signer_id.eq.${id})`,
      select: "events(title)",
    })}`, { headers: serviceHeaders(serviceKey) });
    const usedRows = await used.json().catch(() => null) as Array<{ events?: { title?: string } | null }> | null;
    if (!used.ok || !Array.isArray(usedRows)) return fail(500, "SERVER_ERROR", "Pemakaian tanda tangan belum dapat diperiksa.");
    if (usedRows.length) {
      const titles = usedRows.map((row) => row.events?.title).filter(Boolean).join(", ");
      return fail(409, "SIGNER_IN_USE", `Masih dipilih di pengaturan sertifikat: ${titles || "kegiatan lain"}. Ganti penanda tangannya di sana dulu.`);
    }
    const removed = await fetch(`${supabaseUrl}/rest/v1/certificate_signers?${new URLSearchParams({ id: `eq.${id}`, is_active: "eq.false" })}`, {
      method: "DELETE",
      headers: serviceHeaders(serviceKey, { Prefer: "return=representation" }),
    });
    const removedRows = await removed.json().catch(() => null);
    // 409 = a settings row started using it in the meantime (foreign key).
    if (removed.status === 409) return fail(409, "SIGNER_IN_USE", "Tanda tangan ini baru saja dipilih di pengaturan kegiatan. Muat ulang lalu coba lagi.");
    if (!removed.ok || !Array.isArray(removedRows)) return fail(500, "SERVER_ERROR", "Tanda tangan belum dapat dihapus.");
    if (!removedRows.length) return fail(409, "SIGNER_ACTIVE", "Tanda tangan ini sudah diaktifkan lagi. Muat ulang daftar.");
    await removeObjects([signer.signature_path, signer.stamp_path].filter(Boolean) as string[], BUCKET);
    const signers = await listSigners();
    return json(200, { signers });
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
  const form = await readForm(MAX_MULTIPART_BYTES);
  if (!form) return fail(400, "INVALID_REQUEST", "Data tanda tangan tidak valid atau gambar terlalu besar.");
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
  const removeUploaded = () => removeObjects(uploaded, BUCKET);
  const upload = async (path: string, bytes: Uint8Array) => {
    const ok = await uploadPng(path, bytes, BUCKET);
    if (ok) uploaded.push(path);
    return ok;
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
