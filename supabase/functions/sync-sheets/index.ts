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
// Sheets date serial (days since 1899-12-30) in WIB, so "Terdaftar" sorts and filters as a real date.
const sheetDate = (value: unknown) => {
  const date = typeof value === "string" ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? (date.getTime() + 7 * 3600_000) / 86400_000 + 25569 : "";
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
    text(row.selection_answer), text(row.portfolio_url), statusLabel, payment, attended, sheetDate(row.created_at),
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

// ---- Look of a managed tab. Applied once per tab per FORMAT_VERSION (bump it to restyle), so column
// widths people change afterwards are kept. Colors follow the admin Excel export. ----
const FORMAT_VERSION = "2";
const rgb = (hex: string) => ({
  red: parseInt(hex.slice(1, 3), 16) / 255, green: parseInt(hex.slice(3, 5), 16) / 255, blue: parseInt(hex.slice(5, 7), 16) / 255,
});
const columnWidths: Record<string, number> = {
  Kode: 150, Nama: 180, Kegiatan: 240, Email: 220, WhatsApp: 130, Domisili: 140, Instansi: 180, Usia: 56,
  "Instagram/TikTok": 150, "Tahu dari": 130, "Definisi bahagia": 240, "Jawaban seleksi": 260, "Link portofolio": 180,
  Status: 170, Pembayaran: 190, Hadir: 70, "Terdaftar (WIB)": 150,
};
const tones = [
  { pattern: "Lunas · bukti belum dicek|Menunggu seleksi|Menunggu pembayaran|Belum dibayar|Diproses", text: "#8f5d00", fill: "#fff0c7" },
  { pattern: "Terkonfirmasi|Diterima|Lunas|Ya", text: "#1e6b34", fill: "#e3f1e5" },
  { pattern: "Cadangan", text: "#53141d", fill: "#f6e6d6" },
  { pattern: "Dibatalkan|Kedaluwarsa|Tidak lolos|Gagal|Tidak|Dikembalikan", text: "#6f6667", fill: "#ece8e4" },
];
const columnLetter = (index: number) => String.fromCharCode(65 + index);
type SheetMeta = {
  properties: { sheetId: number; title: string };
  developerMetadata?: Array<{ metadataId: number; metadataKey: string; metadataValue: string }>;
  bandedRanges?: Array<{ bandedRangeId: number }>;
  conditionalFormats?: unknown[];
};
const formatRequests = (sheetId: number, head: string[], isAll: boolean, existing?: SheetMeta) => {
  const width = head.length;
  const col = (name: string) => head.indexOf(name);
  const range = (start: number, end: number, fromRow = 1) => ({ sheetId, startRowIndex: fromRow, startColumnIndex: start, endColumnIndex: end });
  const status = col("Status");
  const requests: unknown[] = [
    ...(existing?.bandedRanges || []).map((band) => ({ deleteBanding: { bandedRangeId: band.bandedRangeId } })),
    ...(existing?.conditionalFormats || []).map((_, index, all) => ({ deleteConditionalFormatRule: { sheetId, index: all.length - 1 - index } })),
    ...(existing?.developerMetadata || []).filter((item) => item.metadataKey === "kb_format")
      .map((item) => ({ deleteDeveloperMetadata: { dataFilter: { developerMetadataLookup: { metadataId: item.metadataId } } } })),
    { updateSheetProperties: {
      properties: { sheetId, gridProperties: { frozenRowCount: 1, frozenColumnCount: 2, hideGridlines: true }, tabColorStyle: { rgbColor: rgb(isAll ? "#7a1f2b" : "#efb635") } },
      fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount,gridProperties.hideGridlines,tabColorStyle",
    } },
    { repeatCell: { range: { sheetId, startColumnIndex: 0, endColumnIndex: width + 1 }, cell: { userEnteredFormat: {
      textFormat: { fontFamily: "DM Sans", fontSize: 10, foregroundColor: rgb("#231f20") }, verticalAlignment: "MIDDLE", wrapStrategy: "CLIP",
      padding: { left: 6, right: 6 },
    } }, fields: "userEnteredFormat(textFormat,verticalAlignment,wrapStrategy,padding,backgroundColor,borders,horizontalAlignment,numberFormat)" } },
    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: width }, cell: { userEnteredFormat: {
      backgroundColor: rgb("#f6e6d6"), textFormat: { fontFamily: "DM Sans", fontSize: 10, bold: true, foregroundColor: rgb("#7a1f2b") },
      verticalAlignment: "MIDDLE", wrapStrategy: "WRAP", padding: { left: 6, right: 6 },
      borders: { bottom: { style: "SOLID_MEDIUM", colorStyle: { rgbColor: rgb("#7a1f2b") } } },
    } }, fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment,wrapStrategy,padding,borders)" } },
    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: width, endColumnIndex: width + 1 }, cell: { userEnteredFormat: {
      textFormat: { fontFamily: "DM Sans", fontSize: 9, italic: true, foregroundColor: rgb("#6f6667") }, verticalAlignment: "MIDDLE",
    } }, fields: "userEnteredFormat(textFormat,verticalAlignment)" } },
    ...["Usia", "Hadir"].map((name) => ({ repeatCell: { range: range(col(name), col(name) + 1), cell: { userEnteredFormat: { horizontalAlignment: "CENTER" } }, fields: "userEnteredFormat.horizontalAlignment" } })),
    { repeatCell: { range: range(col("Terdaftar (WIB)"), col("Terdaftar (WIB)") + 1), cell: { userEnteredFormat: { numberFormat: { type: "DATE_TIME", pattern: "d mmm yyyy, hh:mm" } } }, fields: "userEnteredFormat.numberFormat" } },
    ...head.map((name, index) => ({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: index, endIndex: index + 1 }, properties: { pixelSize: columnWidths[name] || 140 }, fields: "pixelSize" } })),
    { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: width, endIndex: width + 1 }, properties: { pixelSize: 420 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 40 }, fields: "pixelSize" } },
    { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 1 }, properties: { pixelSize: 28 }, fields: "pixelSize" } },
    { addBanding: { bandedRange: { range: range(0, width), rowProperties: { firstBandColorStyle: { rgbColor: rgb("#ffffff") }, secondBandColorStyle: { rgbColor: rgb("#fbf8f4") } } } } },
    // Status, Pembayaran and Hadir are adjacent; one relative formula colors all three.
    ...tones.map((tone, index) => ({ addConditionalFormatRule: { index, rule: {
      ranges: [range(status, col("Hadir") + 1)],
      booleanRule: {
        condition: { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: `=REGEXMATCH(TO_TEXT(${columnLetter(status)}2),"^(${tone.pattern})$")` }] },
        format: { backgroundColorStyle: { rgbColor: rgb(tone.fill) }, textFormat: { bold: true, foregroundColorStyle: { rgbColor: rgb(tone.text) } } },
      },
    } } })),
    { setBasicFilter: { filter: { range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: width } } } },
    { createDeveloperMetadata: { developerMetadata: { metadataKey: "kb_format", metadataValue: FORMAT_VERSION, location: { sheetId }, visibility: "DOCUMENT" } } },
  ];
  return requests;
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
    // Upcoming events always get a tab (empty until the first registrant); past events only when someone
    // registered, so events from before the website don't clutter the sheet.
    const withRegistrants = new Set(registrations.map((row) => String(row.events?.slug)));
    const todayWib = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    const wanted = [{ key: "all", title: "Semua" }, ...events.filter((event) => withRegistrants.has(String(event.slug)) || String(event.event_date || "") >= todayWib).map((event) => ({ key: String(event.slug), title: tabTitle(String(event.title || event.slug)) }))];
    const used = new Set<string>();
    for (const tab of wanted) {
      let title = tab.title;
      for (let n = 2; used.has(title.toLowerCase()); n += 1) title = `${tab.title.slice(0, 85)} (${n})`;
      used.add(title.toLowerCase());
      tab.title = title;
    }

    const meta = await sheetsApi("?fields=sheets(properties(sheetId,title),developerMetadata(metadataId,metadataKey,metadataValue),bandedRanges(bandedRangeId),conditionalFormats)");
    const sheets = (meta.sheets || []) as SheetMeta[];
    const byKey = new Map<string, { sheetId: number; title: string }>();
    const metaByKey = new Map<string, SheetMeta>();
    for (const sheet of sheets) {
      const tag = sheet.developerMetadata?.find((item) => item.metadataKey === "kb_tab");
      if (tag) { byKey.set(tag.metadataValue, sheet.properties); metaByKey.set(tag.metadataValue, sheet); }
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
    // Tabs of events that left the list (archived, draft, or registrants removed) are deleted.
    const wantedKeys = new Set(wanted.map((tab) => tab.key));
    const requests: unknown[] = [...byKey].filter(([key]) => !wantedKeys.has(key))
      .map(([, sheet]) => ({ deleteSheet: { sheetId: sheet.sheetId } }));
    for (const tab of missing) {
      const sheetId = byKey.get(tab.key)!.sheetId;
      requests.push(
        { createDeveloperMetadata: { developerMetadata: { metadataKey: "kb_tab", metadataValue: tab.key, location: { sheetId }, visibility: "DOCUMENT" } } },
      );
    }
    wanted.forEach((tab, index) => {
      const current = byKey.get(tab.key)!;
      requests.push({ updateSheetProperties: { properties: { sheetId: current.sheetId, title: tab.title, index }, fields: "title,index" } });
      current.title = tab.title;
    });
    if (requests.length) await sheetsApi(":batchUpdate", { method: "POST", body: JSON.stringify({ requests }) });
    // Styling is cosmetic: its own batch, so a rejected format request never stops the data from syncing
    // (the tab keeps its old version tag and is retried next run).
    const styling = wanted.flatMap((tab) => {
      const existing = metaByKey.get(tab.key);
      const version = existing?.developerMetadata?.find((item) => item.metadataKey === "kb_format")?.metadataValue;
      return version === FORMAT_VERSION ? [] : formatRequests(byKey.get(tab.key)!.sheetId, header(tab.key === "all"), tab.key === "all", existing);
    });
    if (styling.length) {
      await sheetsApi(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: styling }) })
        .catch((error) => console.error("sync-sheets styling failed", error instanceof Error ? error.message : "unknown"));
    }

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
