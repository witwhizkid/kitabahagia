// Issue volunteer certificates (sertifikat tahap 4). Admin/super_admin only.
// The certificate image is drawn in the admin's browser (js/certificate.js) and
// uploaded here as a PDF; this function owns the codes, the rules and the email.
//   GET  ?event=<slug>                   recipients (confirmed + marked present),
//                                        their certificate state, readiness
//   POST ?event=<slug>&action=issue      JSON { registration_code, recipient_name }:
//                                        the code (new row, or the existing one on
//                                        re-issue) and the number to print
//   POST ?event=<slug>&action=pdf&code=&name=&number=
//                                        body = the PDF; stores it, then saves the
//                                        printed name/number snapshot + issued_at
//   POST ?event=<slug>&action=email      JSON { code }: sends the link via Brevo
// Rules: settings need a number plus a founder and Project Leader (system template) or
// an uploaded design (Canva template); issuing opens on the
// 7th day after the event's last day (WIB).
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
  json(status, { error: { code, message } });

const BUCKET = "certificates";
const MAX_PDF_BYTES = 4 * 1024 * 1024;
const ISSUE_AFTER_DAYS = 3;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const codePattern = /^[A-Za-z0-9]{20,40}$/;
const registrationCodePattern = /^[A-Za-z0-9-]{4,60}$/;
const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

const serviceHeaders = (key: string, extra: Record<string, string> = {}) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  Accept: "application/json",
  ...extra,
});

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

// ~113 bits from a 57-letter alphabet without look-alikes (0/O, 1/l/I).
const newCode = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(40));
  let code = "";
  for (const byte of bytes) {
    if (byte >= 228) continue; // 228 = 4 × 57: keeps the choice uniform
    code += codeAlphabet[byte % 57];
    if (code.length === 20) return code;
  }
  return newCode();
};

const jakartaDate = (value: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(value);

const issueFrom = (eventDate: string, endAt: string | null) => {
  const lastDay = endAt ? jakartaDate(new Date(endAt)) : eventDate;
  const date = new Date(`${lastDay > eventDate ? lastDay : eventDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + ISSUE_AFTER_DAYS);
  return date.toISOString().slice(0, 10);
};

const formatDate = (isoDate: string) => {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${day} ${months[month - 1]} ${year}`;
};

const cleanName = (value: unknown) => {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ");
  return text.length >= 2 && text.length <= 120 && !/[\x00-\x1f\x7f<>]/.test(text) ? text : null;
};

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]!));

type EventRow = { id: string; title: string; event_date: string; end_at: string | null; documentation_url?: string | null };
type Settings = {
  certificate_number: string | null; founder_id: string | null; project_leader_id: string | null;
  template_mode: string; template_path: string | null;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders });
  if (!["GET", "POST"].includes(request.method)) return fail(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const siteUrl = (Deno.env.get("SITE_URL") || "https://kitabahagia.id").replace(/\/$/, "");
  if (!supabaseUrl || !anonKey || !serviceKey) return fail(500, "SERVER_ERROR", "Konfigurasi server belum lengkap.");
  const adminEmail = await authorize(request, supabaseUrl, anonKey, serviceKey);
  if (!adminEmail) return fail(401, "UNAUTHORIZED", "Sesi admin tidak valid atau akses tidak diizinkan.");

  const url = new URL(request.url);
  const slug = url.searchParams.get("event") || "";
  const action = url.searchParams.get("action");
  if (slug.length > 120 || !slugPattern.test(slug)) return fail(400, "INVALID_REQUEST", "Kegiatan tidak valid.");
  if (request.method === "POST" && !["issue", "pdf", "email"].includes(action || "")) {
    return fail(400, "INVALID_REQUEST", "Aksi tidak valid.");
  }

  const rest = async <T>(path: string, init: RequestInit = {}) => {
    const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      ...init,
      headers: serviceHeaders(serviceKey, { "Content-Type": "application/json", ...(init.headers as Record<string, string> || {}) }),
    });
    const data = await response.json().catch(() => null) as T | null;
    return { ok: response.ok, status: response.status, data };
  };

  const events = await rest<EventRow[]>(`events?${new URLSearchParams({ slug: `eq.${slug}`, select: "id,title,event_date,end_at,documentation_url", limit: "1" })}`);
  if (!events.ok || !Array.isArray(events.data)) return fail(500, "SERVER_ERROR", "Kegiatan belum dapat dimuat.");
  const event = events.data[0];
  if (!event) return fail(404, "NOT_FOUND", "Kegiatan tidak ditemukan.");
  const opensOn = issueFrom(event.event_date, event.end_at);
  const settingsResult = await rest<Settings[]>(`event_certificates?${new URLSearchParams({
    event_id: `eq.${event.id}`, select: "certificate_number,founder_id,project_leader_id,template_mode,template_path",
  })}`);
  if (!settingsResult.ok || !Array.isArray(settingsResult.data)) return fail(500, "SERVER_ERROR", "Pengaturan sertifikat belum dapat dimuat.");
  const settings = settingsResult.data[0] || null;
  // A Canva design already carries the signatures; the system template needs them picked.
  const missing = (settings?.template_mode === "canva"
    ? [!settings?.certificate_number && "nomor sertifikat", !settings?.template_path && "desain Canva"]
    : [
      !settings?.certificate_number && "nomor sertifikat",
      !settings?.founder_id && "Founder",
      !settings?.project_leader_id && "Project Leader",
    ]).filter(Boolean) as string[];
  const linkFor = (code: string) => `${siteUrl}/sertifikat?k=${code}`;
  const certificateProjection = "id,registration_id,verification_code,recipient_name,pdf_path,issued_at,email_sent_at,email_error";

  if (request.method === "GET") {
    const registrations = await rest<Array<Record<string, unknown>>>(`registrations?${new URLSearchParams({
      event_id: `eq.${event.id}`,
      registration_status: "eq.confirmed",
      attended_at: "not.is.null",
      select: "id,registration_code,name,email,phone",
      order: "name.asc",
    })}`);
    const certificates = await rest<Array<Record<string, unknown>>>(`certificates?${new URLSearchParams({
      event_id: `eq.${event.id}`, select: certificateProjection,
    })}`);
    if (!registrations.ok || !Array.isArray(registrations.data) || !certificates.ok || !Array.isArray(certificates.data)) {
      return fail(500, "SERVER_ERROR", "Daftar penerima belum dapat dimuat.");
    }
    const byRegistration = new Map(certificates.data.map((row) => [row.registration_id, row]));
    const recipients = registrations.data.map(({ id, ...registration }) => {
      const certificate = byRegistration.get(id);
      return {
        ...registration,
        certificate: certificate ? {
          verification_code: certificate.verification_code,
          recipient_name: certificate.recipient_name,
          issued_at: certificate.issued_at,
          email_sent_at: certificate.email_sent_at,
          email_error: certificate.email_error,
          url: linkFor(String(certificate.verification_code)),
        } : null,
      };
    });
    return json(200, {
      recipients,
      opens_on: opensOn,
      open: jakartaDate(new Date()) >= opensOn,
      missing,
      email_ready: Boolean(Deno.env.get("BREVO_API_KEY")),
    });
  }

  const findCertificate = async (code: string) => {
    if (!codePattern.test(code)) return null;
    const result = await rest<Array<Record<string, unknown>>>(`certificates?${new URLSearchParams({
      verification_code: `eq.${code}`, event_id: `eq.${event.id}`, select: certificateProjection,
    })}`);
    return result.ok && Array.isArray(result.data) ? result.data[0] || null : undefined;
  };

  if (action === "issue") {
    if (missing.length) return fail(409, "SETTINGS_INCOMPLETE", `Lengkapi dulu: ${missing.join(", ")}.`);
    if (jakartaDate(new Date()) < opensOn) {
      return fail(409, "TOO_EARLY", `Sertifikat kegiatan ini baru bisa diterbitkan mulai ${formatDate(opensOn)} (H+${ISSUE_AFTER_DAYS}).`);
    }
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some((key) => !["registration_code", "recipient_name"].includes(key))
      || typeof body.registration_code !== "string" || !registrationCodePattern.test(body.registration_code)) {
      return fail(400, "INVALID_REQUEST", "Data penerbitan tidak valid.");
    }
    const name = cleanName(body.recipient_name);
    if (!name) return fail(400, "INVALID_REQUEST", "Nama di sertifikat harus 2–120 karakter.");
    const registrations = await rest<Array<{ id: string; registration_status: string; attended_at: string | null }>>(
      `registrations?${new URLSearchParams({
        registration_code: `eq.${body.registration_code}`, event_id: `eq.${event.id}`,
        select: "id,registration_status,attended_at", limit: "1",
      })}`,
    );
    if (!registrations.ok || !Array.isArray(registrations.data)) return fail(500, "SERVER_ERROR", "Pendaftaran belum dapat diperiksa.");
    const registration = registrations.data[0];
    if (!registration || registration.registration_status !== "confirmed" || !registration.attended_at) {
      return fail(409, "NOT_ELIGIBLE", "Sertifikat hanya untuk pendaftar terkonfirmasi yang ditandai hadir.");
    }
    const existing = await rest<Array<{ verification_code: string }>>(`certificates?${new URLSearchParams({
      registration_id: `eq.${registration.id}`, select: "verification_code",
    })}`);
    if (!existing.ok || !Array.isArray(existing.data)) return fail(500, "SERVER_ERROR", "Sertifikat belum dapat diperiksa.");
    // Re-issue keeps the code and link; the new name/number are saved with the new PDF.
    let code = existing.data[0]?.verification_code;
    if (!code) {
      code = newCode();
      const inserted = await rest(`certificates`, {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          registration_id: registration.id, event_id: event.id, verification_code: code,
          recipient_name: name, certificate_number: settings!.certificate_number,
          event_title: event.title, event_date: event.event_date, event_end_at: event.end_at, issued_by: adminEmail,
        }),
      });
      if (inserted.status === 409) return fail(409, "CONFLICT", "Sertifikat ini sedang diterbitkan dari tab lain. Muat ulang daftar.");
      if (!inserted.ok) return fail(500, "SERVER_ERROR", "Sertifikat belum dapat dibuat.");
    }
    return json(200, { certificate: { verification_code: code, url: linkFor(code), recipient_name: name, certificate_number: settings!.certificate_number } });
  }

  const code = url.searchParams.get("code") || "";
  if (action === "pdf") {
    const certificate = await findCertificate(code);
    if (certificate === undefined) return fail(500, "SERVER_ERROR", "Sertifikat belum dapat diperiksa.");
    if (!certificate) return fail(404, "NOT_FOUND", "Sertifikat tidak ditemukan.");
    const printedName = cleanName(url.searchParams.get("name"));
    if (!printedName) return fail(400, "INVALID_REQUEST", "Nama di sertifikat harus 2–120 karakter.");
    if (missing.length || url.searchParams.get("number") !== settings!.certificate_number) {
      return fail(409, "SETTINGS_CHANGED", "Pengaturan sertifikat berubah saat menerbitkan. Muat ulang lalu terbitkan lagi.");
    }
    if ((request.headers.get("content-type") || "").split(";")[0].trim() !== "application/pdf"
      || Number(request.headers.get("content-length")) > MAX_PDF_BYTES) {
      return fail(400, "INVALID_FILE", "File sertifikat harus PDF, maksimal 4 MB.");
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength < 100 || bytes.byteLength > MAX_PDF_BYTES || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
      return fail(400, "INVALID_FILE", "File sertifikat harus PDF, maksimal 4 MB.");
    }
    const path = `${event.id}/${code}.pdf`;
    const upload = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: serviceHeaders(serviceKey, { "Content-Type": "application/pdf", "x-upsert": "true" }),
      body: bytes,
    });
    if (!upload.ok) return fail(500, "SERVER_ERROR", "PDF sertifikat belum dapat disimpan.");
    const now = new Date().toISOString();
    const updated = await rest(`certificates?${new URLSearchParams({ verification_code: `eq.${code}` })}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        pdf_path: path, issued_at: now, updated_at: now, issued_by: adminEmail,
        recipient_name: printedName, certificate_number: settings!.certificate_number,
        event_title: event.title, event_date: event.event_date, event_end_at: event.end_at,
      }),
    });
    if (!updated.ok) return fail(500, "SERVER_ERROR", "Sertifikat belum dapat diperbarui.");
    return json(200, { certificate: { verification_code: code, issued_at: now } });
  }

  // action === "email"
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const emailCode = body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 1
    && typeof body.code === "string" ? body.code : "";
  const certificate = await findCertificate(emailCode);
  if (certificate === undefined) return fail(500, "SERVER_ERROR", "Sertifikat belum dapat diperiksa.");
  if (!certificate) return fail(404, "NOT_FOUND", "Sertifikat tidak ditemukan.");
  if (!certificate.pdf_path || !certificate.issued_at) return fail(409, "NOT_ISSUED", "PDF sertifikat belum tersimpan. Terbitkan ulang orang ini.");
  const recipients = await rest<Array<{ email: string }>>(`registrations?${new URLSearchParams({
    id: `eq.${certificate.registration_id}`, select: "email", limit: "1",
  })}`);
  const email = recipients.ok && Array.isArray(recipients.data) ? recipients.data[0]?.email : null;
  const recordEmail = (fields: Record<string, unknown>) => rest(`certificates?${new URLSearchParams({ verification_code: `eq.${emailCode}` })}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }),
  });
  const apiKey = Deno.env.get("BREVO_API_KEY");
  if (!apiKey || !email) {
    const error = !apiKey ? "Email belum diaktifkan (BREVO_API_KEY)." : "Pendaftar tidak punya email.";
    await recordEmail({ email_error: error });
    return json(200, { email: { sent: false, error } });
  }
  const name = String(certificate.recipient_name);
  const link = linkFor(emailCode);
  const dateText = formatDate(event.event_date);
  const firstWord = name.trim().split(/\s+/)[0] || name;
  const greetingName = firstWord === firstWord.toUpperCase() || firstWord === firstWord.toLowerCase()
    ? firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase()
    : firstWord;
  // The documentation folder rides along when the team has filled it in.
  const photos = typeof event.documentation_url === "string" && event.documentation_url.startsWith("https://") ? event.documentation_url : null;
  const photosBlock = photos ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border-radius:14px;background:#f6f1ea"><tr><td style="padding:16px 18px">
<p style="margin:0 0 6px;font-size:15px;font-weight:bold">📸 Foto-foto kegiatannya juga udah ada!</p>
<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#4a4140">Momen-momen seru di ${escapeHtml(event.title)} udah dikumpulin tim dokumentasi. Bebas diunduh buat kenang-kenangan atau diposting. Kalau upload, tag @kitabahagiaa_ ya, biar kami ikut senyum lihatnya.</p>
<a href="${escapeHtml(photos)}" style="display:inline-block;padding:11px 20px;border-radius:999px;border:2px solid #780c06;color:#780c06;text-decoration:none;font-weight:bold;font-size:14px">Lihat foto kegiatan &nearr;</a>
</td></tr></table>` : "";
  const html = `<!doctype html><html lang="id"><body style="margin:0;background:#f6f1ea;font-family:Arial,Helvetica,sans-serif;color:#241f1d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:20px;overflow:hidden">
<tr><td style="height:6px;background:#efb635;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:30px 28px 32px">
<p style="margin:0 0 8px;font-size:12px;font-weight:bold;letter-spacing:.12em;text-transform:uppercase;color:#780c06">Kita Bahagia</p>
<h1 style="margin:0 0 18px;font-size:26px;line-height:1.25">${photos ? "Sertifikat &amp; foto kegiatanmu udah siap!" : "Sertifikatmu udah jadi!"}&nbsp;🎉</h1>
<p style="margin:0 0 14px;font-size:15px;line-height:1.6">Halo ${escapeHtml(greetingName)}!</p>
<p style="margin:0 0 18px;font-size:15px;line-height:1.6">Makasih banyak udah hadir dan ikut nyebar bahagia di <strong>${escapeHtml(event.title)}</strong> (${dateText}). Ini sertifikat relawanmu, bisa dilihat dan diunduh lewat tombol di bawah${photos ? ", plus foto-foto kegiatan buat kenang-kenangan" : ""}.</p>
<p style="margin:0 0 22px;padding:12px 16px;border-radius:12px;background:#fdf5e1;font-size:14px;line-height:1.5">Atas nama<br><strong style="font-size:16px;color:#780c06">${escapeHtml(name)}</strong></p>
<p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;padding:14px 24px;border-radius:999px;background:#780c06;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px">Lihat &amp; unduh sertifikat &rarr;</a></p>
<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#6b6164">Link ini khusus buat kamu dan sama dengan QR di sertifikat, jadi siapa pun yang scan bisa cek keasliannya. Nama salah tulis? Balas aja email ini.</p>
<p style="margin:0 0 22px;font-size:13px;line-height:1.6;color:#6b6164;word-break:break-all">${link}</p>
${photosBlock}
<p style="margin:0;font-size:15px;line-height:1.6">Sampai ketemu di kegiatan berikutnya 💛<br><strong>Tim Kita Bahagia</strong></p>
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:#8a7f7a"><a href="${siteUrl}/jadwal" style="color:#8a7f7a">Jadwal kegiatan</a> · <a href="https://instagram.com/kitabahagiaa_" style="color:#8a7f7a">Instagram</a> · kitabahagia.id</p>
</td></tr></table></body></html>`;
  const send = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      sender: { name: "Kita Bahagia", email: Deno.env.get("CERTIFICATE_EMAIL_FROM") || "noreply@kitabahagia.id" },
      replyTo: { email: "halo@kitabahagia.id", name: "Kita Bahagia" },
      to: [{ email, name }],
      subject: photos ? `${greetingName}, sertifikat & foto kegiatanmu udah jadi!` : `${greetingName}, sertifikat relawanmu udah jadi!`,
      htmlContent: html,
      textContent: `Halo ${greetingName}!\n\nMakasih banyak udah hadir dan ikut nyebar bahagia di ${event.title} (${dateText}). Sertifikat relawanmu atas nama ${name} bisa dilihat dan diunduh di:\n${link}\n\nLink ini khusus buat kamu dan sama dengan QR di sertifikat, jadi siapa pun yang scan bisa cek keasliannya. Nama salah tulis? Balas aja email ini.\n\n${photos ? `Foto-foto kegiatannya juga udah ada, bebas diunduh buat kenang-kenangan (kalau diposting, tag @kitabahagiaa_ ya):\n${photos}\n\n` : ""}Sampai ketemu di kegiatan berikutnya!\nTim Kita Bahagia`,
    }),
  }).catch(() => null);
  if (!send?.ok) {
    const error = `Email gagal dikirim (Brevo ${send?.status ?? "tidak terjangkau"}).`;
    await recordEmail({ email_error: error });
    return json(200, { email: { sent: false, error } });
  }
  const sentAt = new Date().toISOString();
  await recordEmail({ email_sent_at: sentAt, email_error: null });
  return json(200, { email: { sent: true, sent_at: sentAt } });
});
