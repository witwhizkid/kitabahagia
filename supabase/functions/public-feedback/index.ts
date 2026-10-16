// Post-event feedback page (feedback.html?t=<token>, linked from the certificate email).
// GET ?t= → the volunteer's first name, the event, and their saved answer.
// POST { t, rating, highlights, message, anonymous } → saves (one answer per certificate, editable).
// The token is random per certificate; nothing about other volunteers is ever returned.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const responseHeaders = { ...corsHeaders, "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: responseHeaders });
const fail = (status: number, code: string, message: string) => json(status, { error: { code, message } });

const tokenPattern = /^[a-f0-9]{32}$/;
const HIGHLIGHTS = new Set(["warga", "teman", "panitia", "aktivitas", "lokasi"]);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders });
  if (request.method !== "GET" && request.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return fail(500, "SERVER_ERROR", "Konfigurasi server belum lengkap.");
  const rest = (path: string, init: RequestInit = {}) => fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Accept: "application/json", ...(init.headers as Record<string, string> || {}) },
  });

  const body = request.method === "POST" ? await request.json().catch(() => null) as Record<string, unknown> | null : null;
  const token = String(request.method === "POST" ? body?.t ?? "" : new URL(request.url).searchParams.get("t") ?? "");
  if (!tokenPattern.test(token)) return fail(404, "NOT_FOUND", "Link feedback tidak dikenali.");

  const certResponse = await rest(`certificates?${new URLSearchParams({
    feedback_token: `eq.${token}`,
    select: "id,event_id,recipient_name,event_title,event_date,event:events(location,image_url)",
    limit: "1",
  })}`);
  const certs = await certResponse.json().catch(() => null);
  if (!certResponse.ok || !Array.isArray(certs)) return fail(500, "SERVER_ERROR", "Halaman feedback belum dapat dimuat.");
  const cert = certs[0];
  if (!cert) return fail(404, "NOT_FOUND", "Link feedback tidak dikenali.");

  if (request.method === "GET") {
    const saved = await rest(`event_feedback?${new URLSearchParams({ certificate_id: `eq.${cert.id}`, select: "rating,highlights,message,anonymous" })}`)
      .then((response) => response.ok ? response.json() : []).catch(() => []);
    return json(200, {
      first_name: String(cert.recipient_name).trim().split(/\s+/)[0] || "",
      event: { title: cert.event_title, date: cert.event_date, location: cert.event?.location ?? null, image: cert.event?.image_url ?? null },
      feedback: Array.isArray(saved) && saved[0] ? saved[0] : null,
    });
  }

  const rating = Number(body?.rating);
  const highlights = Array.isArray(body?.highlights) ? [...new Set(body!.highlights.map(String))] : [];
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, 1000) : "";
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || highlights.some((key) => !HIGHLIGHTS.has(key))) {
    return fail(400, "INVALID_REQUEST", "Pilih dulu seberapa seru kegiatannya.");
  }
  const save = await rest("event_feedback?on_conflict=certificate_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      certificate_id: cert.id, event_id: cert.event_id, rating, highlights,
      message: message || null, anonymous: body?.anonymous === true, updated_at: new Date().toISOString(),
    }),
  });
  if (!save.ok) return fail(500, "SERVER_ERROR", "Feedback belum tersimpan. Coba lagi sebentar.");
  return json(200, { saved: true });
});
