const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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
  "published_at",
].join(",");

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders });
  if (request.method !== "GET") return fail(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return fail(500, "SERVER_ERROR", "Konfigurasi server belum lengkap.");

  const url = new URL(request.url);
  const slug = url.searchParams.get("slug")?.trim().toLowerCase() || null;
  if (slug && !slugPattern.test(slug)) return fail(400, "INVALID_SLUG", "Slug kisah tidak valid.");

  const rawLimit = Number.parseInt(url.searchParams.get("limit") || "50", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, rawLimit)) : 50;
  const query = new URLSearchParams({
    select: storyProjection,
    status: "eq.published",
    archived_at: "is.null",
    order: "published_at.desc.nullslast,slug.asc",
    limit: String(slug ? 1 : limit),
  });
  if (slug) query.set("slug", `eq.${slug}`);

  const response = await fetch(`${supabaseUrl}/rest/v1/stories?${query}`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: "application/json",
    },
  });
  const stories = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(stories)) return fail(500, "SERVER_ERROR", "Kisah belum dapat dimuat.");
  return json(200, { stories });
});
