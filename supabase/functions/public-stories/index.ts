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

// Hearts (migration 20261020010000): the browser sends a random device id; only HMACs (keyed with the
// server-only key) of it and of the IP reach the database.
const hmac = async (secret: string, value: string) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
const clientIp = (request: Request) =>
  request.headers.get("cf-connecting-ip")?.trim()
  || request.headers.get("x-real-ip")?.trim()
  || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";

const setLike = async (request: Request, supabaseUrl: string, serviceKey: string) => {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const slug = typeof body?.slug === "string" ? body.slug.trim().toLowerCase() : "";
  const device = typeof body?.device === "string" ? body.device : "";
  if (!slugPattern.test(slug) || !/^[a-f0-9]{32}$/.test(device) || typeof body?.liked !== "boolean") {
    return json(400, { error: { code: "INVALID_REQUEST", message: "Permintaan tidak valid." } });
  }
  const ip = clientIp(request);
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/set_story_like`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({
      p_slug: slug,
      p_device_hash: await hmac(serviceKey, `story-like:${device}`),
      p_ip_hash: ip ? await hmac(serviceKey, ip) : null,
      p_liked: body.liked,
    }),
  });
  const likes = await response.json().catch(() => null);
  if (!response.ok) return json(500, { error: { code: "SERVER_ERROR", message: "Belum bisa menyimpan." } });
  if (typeof likes !== "number") return json(404, { error: { code: "NOT_FOUND", message: "Kisah tidak ditemukan." } });
  return json(200, { likes });
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders });
  if (request.method !== "GET" && request.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED", "Metode tidak didukung.");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return fail(500, "SERVER_ERROR", "Konfigurasi server belum lengkap.");
  if (request.method === "POST") return setLike(request, supabaseUrl, serviceKey);

  const url = new URL(request.url);
  const slug = url.searchParams.get("slug")?.trim().toLowerCase() || null;
  if (slug && !slugPattern.test(slug)) return fail(400, "INVALID_SLUG", "Slug kisah tidak valid.");

  const rawLimit = Number.parseInt(url.searchParams.get("limit") || "50", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, rawLimit)) : 50;
  const query = new URLSearchParams({
    // The list brings the related event's family and place for the Beranda story reel.
    select: `${storyProjection},event:events(program_key,location,is_public,archived_at)`,
    status: "eq.published",
    archived_at: "is.null",
    order: "published_at.desc.nullslast,slug.asc",
    limit: String(slug ? 1 : limit),
  });
  if (slug && url.searchParams.get("likes") === "1") {
    // Fresh heart count for the capsule (the story itself may come from the browser cache).
    query.set("slug", `eq.${slug}`);
    query.set("select", "like_count");
  } else if (slug) {
    query.set("slug", `eq.${slug}`);
    // A single story also brings its related event's documentation (Living Archive).
    query.set("select", `${storyProjection},event:events(slug,title,is_public,archived_at,documentation_url,documentation_photos)`);
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/stories?${query}`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: "application/json",
    },
  });
  const rows = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(rows)) return fail(500, "SERVER_ERROR", "Kisah belum dapat dimuat.");
  if (slug && url.searchParams.get("likes") === "1") return json(200, { likes: rows[0]?.like_count ?? 0 });
  // Only a public, unarchived event is exposed, and only what the gallery needs.
  const stories = rows.map(({ event, ...story }: Record<string, unknown>) => {
    const related = event as Record<string, unknown> | null | undefined;
    const visible = related && related.is_public === true && !related.archived_at;
    if (!slug) {
      return { ...story, event: visible ? { program_key: related.program_key ?? null, location: related.location ?? null } : null };
    }
    return {
      ...story,
      event: visible ? {
        slug: related.slug,
        title: related.title,
        documentation_url: related.documentation_url ?? null,
        documentation_photos: Array.isArray(related.documentation_photos) ? related.documentation_photos : [],
      } : null,
    };
  });
  return json(200, { stories });
});
