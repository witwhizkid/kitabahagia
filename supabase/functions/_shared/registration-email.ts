// Registration emails via Brevo. Never throws: a failed email must not fail a
// registration or a payment webhook. Missing BREVO_API_KEY = silently skipped.

type Kind = "confirmed" | "applied";
type Row = {
  registration_code: string; name: string; email: string | null;
  events: {
    title: string; event_date: string; start_time: string | null; end_at: string | null;
    location: string | null; location_url: string | null; whatsapp_group_url: string | null;
    announcement_at: string | null;
  } | null;
};

const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]!));
const jakarta = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3600_000);
const dayText = (isoDate: string) => {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${days[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]}, ${day} ${months[month - 1]} ${year}`;
};
const whenText = (event: NonNullable<Row["events"]>) => {
  const start = event.start_time ? `, ${event.start_time.slice(0, 5).replace(":", ".")}` : "";
  if (!event.end_at) return `${dayText(event.event_date)}${start}${start ? " WIB" : ""}`;
  const end = jakarta(event.end_at);
  const endDate = end.toISOString().slice(0, 10);
  const endTime = `${String(end.getUTCHours()).padStart(2, "0")}.${String(end.getUTCMinutes()).padStart(2, "0")}`;
  return endDate === event.event_date
    ? `${dayText(event.event_date)}${start} – ${endTime} WIB`
    : `${dayText(event.event_date)}${start} – ${dayText(endDate)}, ${endTime} WIB`;
};
const safeUrl = (value: string | null, host?: string) => {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && (!host || url.hostname === host) ? url.toString() : null;
  } catch {
    return null;
  }
};
const firstName = (name: string) => {
  const word = name.trim().split(/\s+/)[0] || name;
  return word === word.toUpperCase() || word === word.toLowerCase() ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word;
};

const rest = (supabaseUrl: string, serviceKey: string, path: string, init: RequestInit = {}) =>
  fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Accept: "application/json", ...init.headers },
    signal: AbortSignal.timeout(5000),
  });

const projection = "registration_code,name,email,events(title,event_date,start_time,end_at,location,location_url,whatsapp_group_url,announcement_at)";

const send = async (supabaseUrl: string, serviceKey: string, row: Row, kind: Kind, accepted = false) => {
  const apiKey = Deno.env.get("BREVO_API_KEY");
  const event = row.events;
  if (!apiKey || !row.email || !event) return;
  const site = (Deno.env.get("SITE_URL") || "https://kitabahagia.id").replace(/\/$/, "");
  const statusLink = `${site}/cek-status?kode=${encodeURIComponent(row.registration_code)}`;
  const greeting = firstName(row.name);
  const when = whenText(event);
  const place = event.location || "Lokasi menyusul";
  const mapUrl = safeUrl(event.location_url) || (event.location ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}` : null);
  const groupUrl = kind === "confirmed" ? safeUrl(event.whatsapp_group_url, "chat.whatsapp.com") : null;
  const announcement = kind === "applied" && event.announcement_at
    ? (() => { const at = jakarta(event.announcement_at); return dayText(at.toISOString().slice(0, 10)); })()
    : null;
  const heading = accepted ? "Selamat, kamu lolos seleksi!&nbsp;🎉"
    : kind === "confirmed" ? "Kamu resmi terdaftar!&nbsp;🎉" : "Pendaftaranmu udah masuk!&nbsp;✨";
  const intro = accepted
    ? `Kamu terpilih jadi relawan di <strong>${escapeHtml(event.title)}</strong>. Tempatmu udah aman. Simpan email ini ya, isinya kode pendaftaran dan info kegiatan.`
    : kind === "confirmed"
    ? `Tempatmu di <strong>${escapeHtml(event.title)}</strong> udah aman. Simpan email ini ya, isinya kode pendaftaran dan info kegiatan.`
    : `Makasih udah daftar di <strong>${escapeHtml(event.title)}</strong>. Pendaftaranmu sekarang masuk tahap seleksi.${announcement ? ` Hasilnya diumumkan <strong>${announcement}</strong>.` : ""} Cek status kapan aja lewat tombol di bawah.`;
  const subject = accepted
    ? `${greeting}, kamu lolos seleksi ${event.title}!`
    : kind === "confirmed"
    ? `${greeting}, kamu resmi terdaftar di ${event.title}!`
    : `${greeting}, pendaftaranmu di ${event.title} udah masuk`;
  const html = `<!doctype html><html lang="id"><body style="margin:0;background:#f6f1ea;font-family:Arial,Helvetica,sans-serif;color:#241f1d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:20px;overflow:hidden">
<tr><td style="height:6px;background:#efb635;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:30px 28px 32px">
<p style="margin:0 0 8px;font-size:12px;font-weight:bold;letter-spacing:.12em;text-transform:uppercase;color:#780c06">Kita Bahagia</p>
<h1 style="margin:0 0 18px;font-size:26px;line-height:1.25">${heading}</h1>
<p style="margin:0 0 14px;font-size:15px;line-height:1.6">Halo ${escapeHtml(greeting)}!</p>
<p style="margin:0 0 18px;font-size:15px;line-height:1.6">${intro}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;border-radius:12px;background:#fdf5e1"><tr><td style="padding:14px 16px;font-size:14px;line-height:1.6">
Kode pendaftaran<br><strong style="font-size:18px;letter-spacing:.04em;color:#780c06">${escapeHtml(row.registration_code)}</strong><br><br>
<strong>Kapan:</strong> ${escapeHtml(when)}<br>
<strong>Di mana:</strong> ${mapUrl ? `<a href="${escapeHtml(mapUrl)}" style="color:#780c06">${escapeHtml(place)}</a>` : escapeHtml(place)}
</td></tr></table>
${groupUrl ? `<p style="margin:0 0 12px"><a href="${escapeHtml(groupUrl)}" style="display:inline-block;padding:14px 24px;border-radius:999px;background:#1f7a4d;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px">Gabung grup WhatsApp peserta</a></p>` : ""}
<p style="margin:0 0 24px"><a href="${statusLink}" style="display:inline-block;padding:14px 24px;border-radius:999px;background:#780c06;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px">Cek status pendaftaran &rarr;</a></p>
<p style="margin:0 0 22px;font-size:13px;line-height:1.6;color:#6b6164">Ada yang salah atau mau tanya? Balas aja email ini.</p>
<p style="margin:0;font-size:15px;line-height:1.6">Sampai ketemu 💛<br><strong>Tim Kita Bahagia</strong></p>
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:#8a7f7a"><a href="${site}/jadwal" style="color:#8a7f7a">Jadwal kegiatan</a> · <a href="https://instagram.com/kitabahagiaa_" style="color:#8a7f7a">Instagram</a> · kitabahagia.id</p>
</td></tr></table></body></html>`;
  const text = `Halo ${greeting}!\n\n${intro.replace(/<[^>]+>/g, "")}\n\nKode pendaftaran: ${row.registration_code}\nKapan: ${when}\nDi mana: ${place}\n${groupUrl ? `Grup WhatsApp peserta: ${groupUrl}\n` : ""}Cek status: ${statusLink}\n\nAda yang salah atau mau tanya? Balas aja email ini.\n\nSampai ketemu!\nTim Kita Bahagia`;
  let error: string | null = null;
  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: { name: "Kita Bahagia", email: Deno.env.get("REGISTRATION_EMAIL_FROM") || Deno.env.get("CERTIFICATE_EMAIL_FROM") || "noreply@kitabahagia.id" },
        replyTo: { email: "halo@kitabahagia.id", name: "Kita Bahagia" },
        to: [{ email: row.email, name: row.name }],
        subject, htmlContent: html, textContent: text,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) error = `Brevo ${response.status}`;
  } catch {
    error = "Brevo tidak terjangkau";
  }
  if (error) console.error("Registration email failed", { kind, error });
  if (kind === "confirmed") {
    await rest(supabaseUrl, serviceKey, `registrations?registration_code=eq.${encodeURIComponent(row.registration_code)}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ confirmation_email_error: error }),
    }).catch(() => null);
  }
};

// Claims the one confirmation email per registration (the column is set before
// sending), then sends it. `filter` picks the registration: by code or by order.
export const sendConfirmationEmail = async (supabaseUrl: string, serviceKey: string, filter: { code?: string; orderId?: string }, accepted = false) => {
  try {
    const where = new URLSearchParams({
      registration_status: "eq.confirmed",
      confirmation_email_sent_at: "is.null",
      select: projection,
      ...(filter.code ? { registration_code: `eq.${filter.code}` } : { payment_reference: `eq.${filter.orderId}` }),
    });
    const claim = await rest(supabaseUrl, serviceKey, `registrations?${where}`, {
      method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ confirmation_email_sent_at: new Date().toISOString() }),
    });
    const rows = claim.ok ? await claim.json().catch(() => null) as Row[] | null : null;
    if (!rows?.length) return;
    await send(supabaseUrl, serviceKey, rows[0], "confirmed", accepted);
  } catch (error) {
    console.error("Confirmation email skipped", error instanceof Error ? error.message : "unknown");
  }
};

export const sendAppliedEmail = async (supabaseUrl: string, serviceKey: string, code: string) => {
  try {
    const response = await rest(supabaseUrl, serviceKey, `registrations?${new URLSearchParams({ registration_code: `eq.${code}`, registration_status: "eq.applied", select: projection, limit: "1" })}`);
    const rows = response.ok ? await response.json().catch(() => null) as Row[] | null : null;
    if (rows?.length) await send(supabaseUrl, serviceKey, rows[0], "applied");
  } catch (error) {
    console.error("Applied email skipped", error instanceof Error ? error.message : "unknown");
  }
};
