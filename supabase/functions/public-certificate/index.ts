// Public certificate check: kitabahagia.id/sertifikat?k=<code> (the QR and the
// emailed link). Returns only what the certificate itself shows, plus a
// 10-minute signed URL for its PDF. No phone, email or registration data.
//   GET ?k=<verification_code>
const responseHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: responseHeaders });

const BUCKET = "certificates";
const SIGNED_URL_SECONDS = 600;
const codePattern = /^[A-Za-z0-9]{20,40}$/;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders });
  if (request.method !== "GET") return json(405, { error: { code: "METHOD_NOT_ALLOWED", message: "Metode tidak didukung." } });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json(500, { error: { code: "SERVER_ERROR", message: "Konfigurasi server belum lengkap." } });
  const code = new URL(request.url).searchParams.get("k") || "";
  const notFound = () => json(404, { error: { code: "NOT_FOUND", message: "Sertifikat tidak ditemukan." } });
  if (!codePattern.test(code)) return notFound();

  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: "application/json" };
  const query = new URLSearchParams({
    verification_code: `eq.${code}`,
    issued_at: "not.is.null",
    select: "recipient_name,certificate_number,event_title,event_date,event_end_at,issued_at,pdf_path",
    limit: "1",
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/certificates?${query}`, { headers });
  const rows = await response.json().catch(() => null) as Array<Record<string, string | null>> | null;
  if (!response.ok || !Array.isArray(rows)) return json(500, { error: { code: "SERVER_ERROR", message: "Sertifikat belum dapat diperiksa." } });
  const row = rows[0];
  if (!row?.pdf_path) return notFound();

  const fileName = `Sertifikat Kita Bahagia - ${row.recipient_name}`.replace(/[^\p{L}\p{N} .-]/gu, "").slice(0, 100);
  const sign = await fetch(`${supabaseUrl}/storage/v1/object/sign/${BUCKET}/${row.pdf_path}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: SIGNED_URL_SECONDS }),
  });
  const signed = await sign.json().catch(() => null) as { signedURL?: string; signedUrl?: string } | null;
  const signedPath = signed?.signedURL || signed?.signedUrl;
  let pdfUrl: string | null = null;
  if (sign.ok && typeof signedPath === "string") {
    const url = new URL(signedPath.startsWith("/object/") ? `${supabaseUrl}/storage/v1${signedPath}` : signedPath, supabaseUrl);
    if (url.origin === new URL(supabaseUrl).origin && url.pathname.startsWith("/storage/v1/object/sign/")) {
      url.searchParams.set("download", `${fileName}.pdf`);
      pdfUrl = url.href;
    }
  }
  const { pdf_path: _path, ...certificate } = row;
  return json(200, { certificate: { ...certificate, role: "Relawan Tingkat Nasional", pdf_url: pdfUrl } });
});
