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

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: responseHeaders });

const errorResponse = (status: number, code: string, message: string) =>
  jsonResponse(status, { events: [], error: { code, message } });

type RegistrationCount = { count: number | string };

type EventRow = {
  slug: string;
  title: string;
  description: string | null;
  registration_description: string | null;
  activities: string[];
  benefits: string[];
  category: string | null;
  category_key: string | null;
  event_date: string;
  start_time: string | null;
  timezone: string;
  end_at: string | null;
  location: string | null;
  status: string;
  capacity: number | null;
  registration_deadline: string | null;
  price: number;
  payment_window_minutes: number | null;
  image_url: string | null;
  image_alt: string | null;
  registrations: RegistrationCount[];
};

const eventProjection = [
  "slug",
  "title",
  "description",
  "registration_description",
  "activities",
  "benefits",
  "category",
  "category_key",
  "event_date",
  "start_time",
  "timezone",
  "end_at",
  "location",
  "status",
  "capacity",
  "registration_deadline",
  "price",
  "payment_window_minutes",
  "image_url",
  "image_alt",
  "registrations(count)",
].join(",");

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const jakartaDate = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

const zonedDateTimeToIso = (date: string, time: string | null, timeZone: string) => {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(time ?? "00:00:00");
  if (!dateMatch || !timeMatch) return null;

  const target = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
    second: Number(timeMatch[3] ?? 0),
  };
  const targetAsUtc = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
    target.second,
  );

  let candidate = targetAsUtc;
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const parts = Object.fromEntries(
        formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]),
      );
      const representedAsUtc = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
        Number(parts.second),
      );
      candidate += targetAsUtc - representedAsUtc;
    }
  } catch {
    return null;
  }

  return new Date(candidate).toISOString();
};

const occupiedSlots = (event: EventRow) => {
  const count = Number(event.registrations?.[0]?.count ?? 0);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders });
  if (request.method !== "GET") {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Gunakan metode GET.");
  }

  const requestUrl = new URL(request.url);
  const demo = requestUrl.searchParams.get("demo") === "true";
  const slug = requestUrl.searchParams.get("slug")?.trim().toLowerCase() ?? null;
  if (slug !== null && (slug.length > 120 || !slugPattern.test(slug))) {
    return errorResponse(400, "INVALID_SLUG", "Slug kegiatan tidak valid.");
  }

  const rawLimit = requestUrl.searchParams.get("limit");
  if (rawLimit !== null && !/^\d+$/.test(rawLimit)) {
    return errorResponse(400, "INVALID_LIMIT", "Limit harus berupa angka.");
  }
  const limit = Math.min(50, Math.max(1, Number(rawLimit ?? 50)));

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing required Supabase server environment variables");
    return errorResponse(500, "SERVER_ERROR", "Terjadi kesalahan pada server.");
  }

  const query = new URLSearchParams({
    select: eventProjection,
    is_public: "eq.true",
    archived_at: "is.null",
    is_demo: demo ? "eq.true" : "eq.false",
    // Same rule as create_registration: unpaid registrations hold a seat only until payment_deadline.
    "registrations.or": `(registration_status.eq.confirmed,and(registration_status.eq.pending_payment,or(payment_deadline.is.null,payment_deadline.gt."${new Date().toISOString()}")))`,
    order: "event_date.asc,start_time.asc,slug.asc",
    limit: String(slug ? 1 : limit),
  });
  if (slug) {
    query.set("slug", `eq.${slug}`);
    query.set("status", "neq.draft");
  } else {
    query.set("event_date", `gte.${jakartaDate()}`);
    query.set("status", "in.(open,full)");
  }

  try {
    const databaseResponse = await fetch(`${supabaseUrl}/rest/v1/events?${query}`, {
      method: "GET",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: "application/json",
      },
    });
    const rows = await databaseResponse.json().catch(() => null) as EventRow[] | null;
    if (!databaseResponse.ok || !Array.isArray(rows)) {
      console.error("Public events query failed", { status: databaseResponse.status });
      return errorResponse(500, "SERVER_ERROR", "Data kegiatan belum dapat dimuat.");
    }

    const events = rows.map((event) => {
      const startAt = zonedDateTimeToIso(event.event_date, event.start_time, event.timezone);
      if (!startAt) throw new Error("INVALID_EVENT_TIMEZONE");
      const used = occupiedSlots(event);
      return {
        slug: event.slug,
        title: event.title,
        description: event.description,
        registration_description: event.registration_description,
        activities: event.activities,
        benefits: event.benefits,
        category: event.category,
        category_key: event.category_key,
        start_at: startAt,
        end_at: event.end_at ? new Date(event.end_at).toISOString() : null,
        location: event.location,
        status: event.status,
        capacity: event.capacity,
        remaining_capacity: event.capacity === null ? null : Math.max(event.capacity - used, 0),
        registration_deadline: event.registration_deadline,
        price: event.price,
        payment_window_minutes: event.payment_window_minutes ?? null,
        image_url: event.image_url,
        image_alt: event.image_alt,
      };
    });

    return jsonResponse(200, { events });
  } catch (error) {
    console.error("Public events request failed", error instanceof Error ? error.message : "Unknown error");
    return errorResponse(500, "SERVER_ERROR", "Data kegiatan belum dapat dimuat.");
  }
});
