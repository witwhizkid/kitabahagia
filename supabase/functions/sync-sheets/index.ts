// Live registrant spreadsheet (Oct 2026, owner: teams should see who registered without downloading
// Excel). pg_cron calls this every 5 minutes (header x-sync-secret = SHEETS_SYNC_SECRET); it rewrites
// one Google Sheet: a "Semua" tab plus one tab per event (matched by developer metadata, so renaming an
// event renames its tab). The sheet is read-only in practice: anything typed into these tabs is
// overwritten on the next run. Secrets: GOOGLE_SERVICE_ACCOUNT_JSON, SHEETS_SPREADSHEET_ID,
// SHEETS_SYNC_SECRET. Setup: "Live spreadsheet" in supabase/README.md.

const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

type Row = Record<string, unknown> & { events?: Record<string, unknown> | null };

const statusLabels: Record<string, string> = {
  applied: "Menunggu seleksi", pending_payment: "Menunggu pembayaran", confirmed: "Terkonfirmasi",
  waitlisted: "Cadangan", rejected: "Tidak lolos", cancelled: "Dibatalkan", expired: "Kedaluwarsa",
};
const paymentLabels: Record<string, string> = {
  not_required: "Tidak perlu bayar", unpaid: "Belum dibayar", pending: "Diproses", paid: "Lunas",
  failed: "Gagal", expired: "Kedaluwarsa", refunded: "Dikembalikan",
};
const referralLabels: Record<string, string> = {
  instagram: "Instagram", tiktok: "TikTok", whatsapp: "Grup/pesan WhatsApp", teman: "Informasi teman",
  kampus: "Kampus, sekolah, atau komunitas", website: "Website Kita Bahagia", lainnya: "Lainnya",
};
const wib = new Intl.DateTimeFormat("id-ID", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta",
});
const formatTime = (value: unknown) => {
  const date = typeof value === "string" ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? wib.format(date) : "";
};

const header = (withEvent: boolean) => [
  "Kode", "Nama", ...(withEvent ? ["Kegiatan"] : []), "Email", "WhatsApp", "Domisili", "Instansi", "Usia",
  "Instagram/TikTok", "Tahu dari", "Definisi bahagia", "Jawaban seleksi", "Link portofolio", "Status",
  "Pembayaran", "Hadir", "Terdaftar (WIB)",
];

const toRow = (row: Row, withEvent: boolean, now: Date) => {
  const event = row.events || {};
  let status = String(row.registration_status || "");
  const deadline = typeof row.payment_deadline === "string" ? new Date(row.payment_deadline) : null;
  // Same rule as admin-registrations: an unpaid hold past its deadline counts as expired.
  if (status === "pending_payment" && row.payment_status !== "paid" && deadline && deadline <= now) status = "expired";
  const statusLabel = status === "confirmed" && event.registration_mode === "selection"
    ? "Diterima" : statusLabels[status] || status;
  const unchecked = status === "confirmed" && row.payment_proof_submitted_at && !row.payment_reviewed_at;
  const payment = status === "expired" ? "Kedaluwarsa"
    : unchecked ? "Lunas · bukti belum dicek" : paymentLabels[String(row.payment_status)] || String(row.payment_status || "");
  const attended = status !== "confirmed" ? "" : row.attended_at ? "Ya" : row.absent_at ? "Tidak" : "";
  const text = (value: unknown) => (value === null || value === undefined ? "" : String(value));
  return [
    text(row.registration_code), text(row.name), ...(withEvent ? [text(event.title)] : []),
    text(row.email), text(row.phone), text(row.domicile), text(row.institution),
    typeof row.age === "number" ? row.age : text(row.age), text(row.social_account),
    referralLabels[text(row.referral_source)] || text(row.referral_source), text(row.reason),
    text(row.selection_answer), text(row.portfolio_url), statusLabel, payment, attended, formatTime(row.created_at),
  ];
};

// ---- Google auth: service-account JWT (RS256) exchanged for an access token. ----
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const googleToken = async (account: { client_email: string; private_key: string }) => {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: account.client_email, scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  })}`;
  const pem = account.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${base64url(signature)}` }),
  });
  const result = await response.json().catch(() => null) as { access_token?: string } | null;
  if (!response.ok || !result?.access_token) throw new Error(`google token ${response.status}`);
  return result.access_token;
};

// Sheet tab titles: no []:*?/\ and at most 100 characters.
const tabTitle = (value: string) => value.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 90) || "Kegiatan";
const quoted = (title: string) => `'${title.replace(/'/g, "''")}'`;

Deno.serve(async (request) => {
  const secret = Deno.env.get("SHEETS_SYNC_SECRET");
  if (!secret || request.headers.get("x-sync-secret") !== secret) return json(401, { ok: false });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const spreadsheetId = Deno.env.get("SHEETS_SPREADSHEET_ID");
  let account: { client_email: string; private_key: string } | null = null;
  try { account = JSON.parse(Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON") || "null"); } catch { account = null; }
  if (!supabaseUrl || !serviceKey || !spreadsheetId || !account?.client_email || !account?.private_key) {
    return json(500, { ok: false, error: "missing configuration" });
  }

  try {
    const rest = async (path: string) => {
      const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Range: "0-9999" },
      });
      const rows = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(rows)) throw new Error(`supabase ${response.status}`);
      return rows as Row[];
    };
    const events = await rest(`events?select=id,slug,title,event_date&archived_at=is.null&status=neq.draft&order=event_date.desc`);
    const registrations = await rest(`registrations?select=registration_code,name,email,phone,domicile,institution,age,social_account,referral_source,reason,selection_answer,portfolio_url,registration_status,payment_status,payment_deadline,payment_proof_submitted_at,payment_reviewed_at,attended_at,absent_at,created_at,event_id,events!inner(slug,title,registration_mode,archived_at)&events.archived_at=is.null&order=created_at.asc`);

    const token = await googleToken(account);
    const sheetsApi = async (path: string, init: RequestInit = {}) => {
      const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(`sheets ${response.status} ${JSON.stringify(body?.error?.message || "")}`);
      return body as Record<string, any>;
    };

    // Wanted tabs: "Semua" first, then one per event (newest event first).
    const wanted = [{ key: "all", title: "Semua" }, ...events.map((event) => ({ key: String(event.slug), title: tabTitle(String(event.title || event.slug)) }))];
    const used = new Set<string>();
    for (const tab of wanted) {
      let title = tab.title;
      for (let n = 2; used.has(title.toLowerCase()); n += 1) title = `${tab.title.slice(0, 85)} (${n})`;
      used.add(title.toLowerCase());
      tab.title = title;
    }

    const meta = await sheetsApi("?fields=sheets(properties(sheetId,title),developerMetadata(metadataKey,metadataValue))");
    const sheets = (meta.sheets || []) as Array<{ properties: { sheetId: number; title: string }; developerMetadata?: Array<{ metadataKey: string; metadataValue: string }> }>;
    const byKey = new Map<string, { sheetId: number; title: string }>();
    for (const sheet of sheets) {
      const tag = sheet.developerMetadata?.find((item) => item.metadataKey === "kb_tab");
      if (tag) byKey.set(tag.metadataValue, sheet.properties);
    }
    // A wanted title may clash with an unmanaged tab (e.g. one a person made); give ours a suffix.
    const unmanaged = new Set(sheets.filter((sheet) => !sheet.developerMetadata?.some((item) => item.metadataKey === "kb_tab"))
      .map((sheet) => sheet.properties.title.toLowerCase()));
    for (const tab of wanted) if (unmanaged.has(tab.title.toLowerCase())) tab.title = `${tab.title.slice(0, 80)} · KB`;

    // Create missing tabs, then tag, format and rename in one batch.
    const missing = wanted.filter((tab) => !byKey.has(tab.key));
    if (missing.length) {
      const added = await sheetsApi(":batchUpdate", {
        method: "POST",
        body: JSON.stringify({ requests: missing.map((tab) => ({ addSheet: { properties: { title: `${tab.title.slice(0, 80)} ${crypto.randomUUID().slice(0, 6)}`, gridProperties: { frozenRowCount: 1 } } } })) }),
      });
      missing.forEach((tab, index) => {
        const properties = added.replies[index].addSheet.properties;
        byKey.set(tab.key, { sheetId: properties.sheetId, title: properties.title });
      });
    }
    const requests: unknown[] = [];
    for (const tab of missing) {
      const sheetId = byKey.get(tab.key)!.sheetId;
      requests.push(
        { createDeveloperMetadata: { developerMetadata: { metadataKey: "kb_tab", metadataValue: tab.key, location: { sheetId }, visibility: "DOCUMENT" } } },
        { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.965, green: 0.902, blue: 0.839 }, textFormat: { bold: true, foregroundColor: { red: 0.33, green: 0.08, blue: 0.11 } } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
        { setBasicFilter: { filter: { range: { sheetId } } } },
      );
    }
    wanted.forEach((tab, index) => {
      const current = byKey.get(tab.key)!;
      requests.push({ updateSheetProperties: { properties: { sheetId: current.sheetId, title: tab.title, index }, fields: "title,index" } });
      current.title = tab.title;
    });
    if (requests.length) await sheetsApi(":batchUpdate", { method: "POST", body: JSON.stringify({ requests }) });

    // Rewrite the values of every managed tab.
    const now = new Date();
    const updatedAt = `Diperbarui ${wib.format(now)} WIB · otomatis tiap 5 menit, jangan diketik di tab ini`;
    const data = wanted.map((tab) => {
      const withEvent = tab.key === "all";
      const rows = registrations.filter((row) => withEvent || row.events?.slug === tab.key).map((row) => toRow(row, withEvent, now));
      const head = header(withEvent);
      return { range: `${quoted(tab.title)}!A1`, values: [[...head, updatedAt], ...rows] };
    });
    await sheetsApi("/values:batchClear", { method: "POST", body: JSON.stringify({ ranges: wanted.map((tab) => `${quoted(tab.title)}!A:Z`) }) });
    await sheetsApi("/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data }) });
    return json(200, { ok: true, tabs: wanted.length, registrations: registrations.length });
  } catch (error) {
    console.error("sync-sheets failed", error instanceof Error ? error.message : "unknown");
    return json(500, { ok: false });
  }
});
