const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const MAX_PROOF_BYTES = 2 * 1024 * 1024;
const MAX_CV_BYTES = 5 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_PROOF_BYTES + MAX_CV_BYTES + 64 * 1024;
const proofMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const jsonResponse = (status: number, body: Record<string, unknown>) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } },
);
const errorResponse = (status: number, code: string, message: string) =>
  jsonResponse(status, { success: false, error: { code, message } });

const errorMessages: Record<string, string> = {
  INVALID_REQUEST: "Data pendaftaran tidak valid.",
  INVALID_INSTAGRAM_PROOF: "Unggah screenshot follow Instagram dalam format JPG, PNG, atau WebP dengan ukuran maksimal 2 MB.",
  INVALID_CV: "CV/portofolio harus berupa file PDF dengan ukuran maksimal 5 MB.",
  INVALID_PORTFOLIO_URL: "Link portofolio harus diawali https:// dan maksimal 500 karakter.",
  FILES_TOO_LARGE: "Ukuran file terlalu besar. Bukti follow maksimal 2 MB dan CV/portofolio maksimal 5 MB.",
  EVENT_NOT_FOUND: "Kegiatan tidak ditemukan.",
  EVENT_NOT_OPEN: "Kegiatan tidak sedang menerima pendaftaran.",
  REGISTRATION_CLOSED: "Batas waktu pendaftaran telah berakhir.",
  EVENT_FULL: "Kapasitas kegiatan sudah penuh.",
  // Deliberately does not say whether the email or the phone number matched.
  ALREADY_REGISTERED: "Email atau nomor WhatsApp ini sudah terdaftar di kegiatan ini. Jika belum membayar, lanjutkan pembayaran dari perangkat yang sama atau hubungi admin dengan kode pendaftaranmu.",
  REGISTRATION_NOT_OPEN: "Pendaftaran kegiatan ini belum dibuka.",
  // Deliberately says nothing about how many people applied.
  APPLICANTS_FULL: "Pendaftaran kegiatan ini sudah ditutup.",
  RATE_LIMITED: "Terlalu banyak percobaan pendaftaran dari jaringan ini. Coba lagi beberapa menit lagi.",
  INVALID_ANSWER: "Jawaban seleksi belum memenuhi syarat.",
};
const conflictErrors = new Set(["EVENT_NOT_OPEN", "REGISTRATION_CLOSED", "EVENT_FULL", "ALREADY_REGISTERED", "REGISTRATION_NOT_OPEN", "APPLICANTS_FULL"]);
const allowedFields = new Set([
  "event_slug", "name", "phone", "email", "domicile", "institution", "reason", "notes", "consent",
  "selection_answer", "commitment", "portfolio_url",
]);

type RegistrationInput = {
  event_slug: string; name: string; phone: string; email: string;
  domicile: string | null; institution: string | null;
  reason: string; notes: string | null; consent: true;
  selection_answer: string | null; commitment: boolean | null; portfolio_url: string | null;
};
type ProofFile = { bytes: Uint8Array; contentType: string; extension: string };

const normalizePhone = (value: string) => value.trim().replace(/[\s().-]/g, "");

const validateInput = (value: unknown): RegistrationInput | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !allowedFields.has(key))) return null;
  if (typeof body.event_slug !== "string" || typeof body.name !== "string"
    || typeof body.phone !== "string" || typeof body.email !== "string"
    || typeof body.reason !== "string" || body.consent !== true
    || (body.domicile !== undefined && body.domicile !== null && typeof body.domicile !== "string")
    || (body.institution !== undefined && body.institution !== null && typeof body.institution !== "string")
    || (body.notes !== undefined && body.notes !== null && typeof body.notes !== "string")
    || (body.selection_answer !== undefined && body.selection_answer !== null && typeof body.selection_answer !== "string")
    || (body.commitment !== undefined && body.commitment !== null && typeof body.commitment !== "boolean")
    || (body.portfolio_url !== undefined && body.portfolio_url !== null && typeof body.portfolio_url !== "string")) return null;

  const eventSlug = body.event_slug.trim().toLowerCase();
  const name = body.name.trim();
  if (!/^\+?[0-9\s().-]+$/.test(body.phone.trim())) return null;
  const phone = normalizePhone(body.phone);
  const email = body.email.trim().toLowerCase();
  const domicile = typeof body.domicile === "string" ? body.domicile.trim() || null : null;
  const institution = typeof body.institution === "string" ? body.institution.trim() || null : null;
  const reason = body.reason.trim();
  const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
  // Browsers submit textarea line breaks as CRLF; count them like the database does.
  const selectionAnswer = typeof body.selection_answer === "string"
    ? body.selection_answer.replace(/\r\n?/g, "\n").trim() || null : null;
  const commitment = typeof body.commitment === "boolean" ? body.commitment : null;
  // Format is checked by the database (INVALID_PORTFOLIO_URL), which owns the rule.
  const portfolioUrl = typeof body.portfolio_url === "string" ? body.portfolio_url.trim() || null : null;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(eventSlug) || eventSlug.length > 120
    || name.length < 2 || name.length > 150 || !/^\+?\d{8,20}$/.test(phone)
    || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || (domicile !== null && domicile.length > 200)
    || (institution !== null && institution.length > 200)
    || reason.length < 1 || reason.length > 2000
    || (notes !== null && notes.length > 2000)
    || (selectionAnswer !== null && [...selectionAnswer].length > 2000)) return null;
  return {
    event_slug: eventSlug, name, phone, email, domicile, institution, reason, notes, consent: true,
    selection_answer: selectionAnswer, commitment, portfolio_url: portfolioUrl,
  };
};

const readBoundedBody = async (request: Request, maxBytes: number) => {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
};

const parseMultipart = async (request: Request, contentType: string) => {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MULTIPART_BYTES) return { tooLarge: true as const };
  const bytes = await readBoundedBody(request, MAX_MULTIPART_BYTES);
  if (!bytes) return { tooLarge: true as const };
  let form: FormData;
  try {
    form = await new Request(request.url, { method: "POST", headers: { "content-type": contentType }, body: bytes }).formData();
  } catch {
    return null;
  }
  const fields: Record<string, unknown> = {};
  const files: Record<string, File> = {};
  for (const [key, value] of form.entries()) {
    if (key === "instagram_proof" || key === "cv") {
      if (files[key] || typeof value === "string") return null;
      files[key] = value;
      continue;
    }
    if (!allowedFields.has(key) || Object.hasOwn(fields, key) || typeof value !== "string") return null;
    fields[key] = value;
  }
  fields.consent = fields.consent === "true";
  if (fields.commitment !== undefined) fields.commitment = fields.commitment === "true";
  return { fields, proof: files.instagram_proof ?? null, cv: files.cv ?? null, tooLarge: false as const };
};

const validateProof = async (file: File | null): Promise<ProofFile | null> => {
  if (!file || file.size < 1 || file.size > MAX_PROOF_BYTES || !proofMimeTypes.has(file.type)) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e
    && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  const webp = bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
  if (file.type === "image/jpeg" && jpeg) return { bytes, contentType: file.type, extension: "jpg" };
  if (file.type === "image/png" && png) return { bytes, contentType: file.type, extension: "png" };
  if (file.type === "image/webp" && webp) return { bytes, contentType: file.type, extension: "webp" };
  return null;
};

const validateCv = async (file: File): Promise<ProofFile | null> => {
  if (file.size < 5 || file.size > MAX_CV_BYTES || file.type !== "application/pdf") return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") return null;
  return { bytes, contentType: file.type, extension: "pdf" };
};

// Per-IP limit (see migration 20261002010000). Only a keyed hash of the IP is stored.
// Fails open: if the check itself errors, the registration still goes through.
// The client can prepend anything to x-forwarded-for, so prefer headers the
// platform sets itself (Cloudflare's cf-connecting-ip, then x-real-ip).
const clientIp = (request: Request) =>
  request.headers.get("cf-connecting-ip")?.trim()
  || request.headers.get("x-real-ip")?.trim()
  || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";

const withinRateLimit = async (request: Request, supabaseUrl: string, serviceRoleKey: string) => {
  const ip = clientIp(request);
  if (!ip) return true;
  try {
    // HMAC with the server-only key: the stored hash cannot be reversed by trying every IPv4.
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(serviceRoleKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ip));
    const ipHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/check_registration_rate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({ p_ip_hash: ipHash }),
    });
    if (!response.ok) {
      console.error("Rate limit check failed", { status: response.status });
      return true;
    }
    return (await response.json()) !== false;
  } catch {
    console.error("Rate limit check request failed");
    return true;
  }
};

const storagePathUrl = (base: string, bucket: string, path: string) =>
  `${base}/storage/v1/object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return errorResponse(405, "INVALID_REQUEST", "Gunakan metode POST.");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing required Supabase server environment variables");
    return errorResponse(500, "SERVER_ERROR", "Terjadi kesalahan pada server.");
  }
  // Checked before the body is read, so large upload spam is refused cheaply.
  if (!(await withinRateLimit(request, supabaseUrl, serviceRoleKey))) {
    return errorResponse(429, "RATE_LIMITED", errorMessages.RATE_LIMITED);
  }

  // The multipart boundary is case-sensitive, so only the comparison is lowercased.
  const contentType = request.headers.get("content-type") ?? "";
  const isMultipart = contentType.toLowerCase().startsWith("multipart/form-data;");
  let body: unknown;
  let proofFile: File | null = null;
  let cvFile: File | null = null;
  if (isMultipart) {
    const parsed = await parseMultipart(request, contentType);
    if (!parsed) return errorResponse(400, "INVALID_REQUEST", errorMessages.INVALID_REQUEST);
    if (parsed.tooLarge) return errorResponse(413, "FILES_TOO_LARGE", errorMessages.FILES_TOO_LARGE);
    body = parsed.fields;
    proofFile = parsed.proof;
    cvFile = parsed.cv;
  } else if (contentType.toLowerCase().includes("application/json")) {
    try { body = await request.json(); }
    catch { return errorResponse(400, "INVALID_REQUEST", errorMessages.INVALID_REQUEST); }
  } else {
    return errorResponse(400, "INVALID_REQUEST", errorMessages.INVALID_REQUEST);
  }
  const input = validateInput(body);
  if (!input) return errorResponse(400, "INVALID_REQUEST", errorMessages.INVALID_REQUEST);

  let uploadedPath: string | null = null;
  let uploadedCvPath: string | null = null;
  const removeObject = async (bucket: string, path: string) => {
    try {
      const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}`, {
        method: "DELETE",
        headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: [path] }),
      });
      if (!response.ok) console.error("Upload cleanup failed", { bucket, status: response.status });
    } catch {
      console.error("Upload cleanup request failed", { bucket });
    }
  };
  const removeUploadedProof = async () => {
    if (uploadedPath) await removeObject("instagram-proofs", uploadedPath);
    if (uploadedCvPath) await removeObject("selection-cvs", uploadedCvPath);
    uploadedPath = null;
    uploadedCvPath = null;
  };
  const uploadObject = (bucket: string, path: string, file: ProofFile) => fetch(storagePathUrl(supabaseUrl, bucket, path), {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": file.contentType,
      "x-upsert": "false",
    },
    body: file.bytes,
  });

  try {
    // Multipart is accepted only for events the database defines as free + selection.
    if (isMultipart) {
      const query = new URLSearchParams({ select: "slug,price,registration_mode", slug: `eq.${input.event_slug}`, limit: "1" });
      const eventResponse = await fetch(`${supabaseUrl}/rest/v1/events?${query}`, {
        headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, Accept: "application/json" },
      });
      const events = await eventResponse.json().catch(() => null) as Array<Record<string, unknown>> | null;
      if (!eventResponse.ok || !Array.isArray(events)) return errorResponse(500, "SERVER_ERROR", "Terjadi kesalahan pada server.");
      if (!events.length) return errorResponse(404, "EVENT_NOT_FOUND", errorMessages.EVENT_NOT_FOUND);
      if (events[0].registration_mode !== "selection" || Number(events[0].price) !== 0) {
        return errorResponse(400, "INVALID_REQUEST", errorMessages.INVALID_REQUEST);
      }

      const proof = await validateProof(proofFile);
      if (!proof) return errorResponse(400, "INVALID_INSTAGRAM_PROOF", errorMessages.INVALID_INSTAGRAM_PROOF);
      const cv = cvFile ? await validateCv(cvFile) : null;
      if (cvFile && !cv) return errorResponse(400, "INVALID_CV", errorMessages.INVALID_CV);

      // Paths are recorded before each upload: if the request dies after Storage kept
      // the file, the catch below still knows what to remove (deleting a missing object is a no-op).
      uploadedPath = `${input.event_slug}/${crypto.randomUUID()}.${proof.extension}`;
      const uploadResponse = await uploadObject("instagram-proofs", uploadedPath, proof);
      if (!uploadResponse.ok) {
        console.error("Instagram proof upload failed", { status: uploadResponse.status });
        await removeUploadedProof();
        return errorResponse(500, "SERVER_ERROR", "Bukti follow belum dapat disimpan. Silakan coba lagi.");
      }
      if (cv) {
        uploadedCvPath = `${input.event_slug}/${crypto.randomUUID()}.pdf`;
        const cvResponse = await uploadObject("selection-cvs", uploadedCvPath, cv);
        if (!cvResponse.ok) {
          console.error("CV upload failed", { status: cvResponse.status });
          await removeUploadedProof();
          return errorResponse(500, "SERVER_ERROR", "CV/portofolio belum dapat disimpan. Silakan coba lagi.");
        }
      }
    }

    const rpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/create_registration`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": serviceRoleKey, "Authorization": `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({
        p_event_slug: input.event_slug, p_name: input.name, p_phone: input.phone,
        p_email: input.email, p_reason: input.reason, p_notes: input.notes, p_consent: input.consent,
        p_domicile: input.domicile, p_institution: input.institution,
        // Sent only when present, so other sign-ups keep working if this function is
        // deployed before the migration that adds the parameter (20260927010000, 20260929010000,
        // 20260930010000).
        ...(input.selection_answer !== null ? { p_selection_answer: input.selection_answer } : {}),
        ...(input.commitment !== null ? { p_commitment: input.commitment } : {}),
        ...(uploadedPath !== null ? { p_instagram_proof_path: uploadedPath } : {}),
        ...(uploadedCvPath !== null ? { p_cv_path: uploadedCvPath } : {}),
        ...(input.portfolio_url !== null ? { p_portfolio_url: input.portfolio_url } : {}),
      }),
    });
    const result = await rpcResponse.json().catch(() => null) as Record<string, unknown> | null;
    if (rpcResponse.ok && result) return jsonResponse(201, result);

    const databaseCode = typeof result?.message === "string" ? result.message : "";
    if (databaseCode in errorMessages) {
      await removeUploadedProof();
      const status = databaseCode === "EVENT_NOT_FOUND" ? 404 : conflictErrors.has(databaseCode) ? 409 : 400;
      return errorResponse(status, databaseCode, errorMessages[databaseCode]);
    }
    console.error("Registration RPC failed", { status: rpcResponse.status, code: result?.code });
    await removeUploadedProof();
    return errorResponse(500, "SERVER_ERROR", "Terjadi kesalahan pada server.");
  } catch (error) {
    await removeUploadedProof();
    console.error("Registration request failed", error instanceof Error ? error.message : "Unknown error");
    return errorResponse(500, "SERVER_ERROR", "Terjadi kesalahan pada server.");
  }
});
