(() => {
  "use strict";

  const CONFIG = Object.freeze({
    supabaseUrl: "https://cmrdapfuqtjlmpepfwfq.supabase.co",
    publishableKey: "sb_publishable_9VReqYf_mLWEpsDHUtq_FA_Hx-dTqSE",
    sessionKey: "kb_admin_session",
  });
  const adminEventsUrl = `${CONFIG.supabaseUrl}/functions/v1/admin-events`;
  const adminRegistrationsUrl = `${CONFIG.supabaseUrl}/functions/v1/admin-registrations`;
  const adminUsersUrl = `${CONFIG.supabaseUrl}/functions/v1/admin-users`;
  const adminStoriesUrl = `${CONFIG.supabaseUrl}/functions/v1/admin-stories`;
  const adminCertificatesUrl = `${CONFIG.supabaseUrl}/functions/v1/admin-certificates`;

  const $ = (selector) => document.querySelector(selector);
  const loginView = $("#login-view");
  const loginPanel = $("#login-view .login-panel:not(#password-setup-panel)");
  const passwordSetupPanel = $("#password-setup-panel");
  const adminView = $("#admin-view");
  const eventsView = $("#events-view");
  const formView = $("#form-view");
  const registrationsView = $("#registrations-view");
  const storiesView = $("#stories-view");
  const storyFormView = $("#story-form-view");
  const adminsView = $("#admins-view");
  const certificatesView = $("#certificates-view");
  const loginForm = $("#login-form");
  const passwordSetupForm = $("#password-setup-form");
  const eventForm = $("#event-form");
  const storyForm = $("#story-form");
  const inviteAdminForm = $("#invite-admin-form");
  const eventsList = $("#events-list");
  const registrationsList = $("#registrations-list");
  const storiesList = $("#stories-list");
  const adminsList = $("#admins-list");
  const eventArchiveFilter = $("#event-archive-filter");
  const storyArchiveFilter = $("#story-archive-filter");
  let events = [];
  let registrations = [];
  let stories = [];
  let admins = [];
  let currentRole = "";
  let registrationLifecycle = "active";
  let selectionOverview = null;
  let applicantDialogIndex = -1;
  let selectionDecisionPending = false;
  let imageUploading = false;
  let storyImageUploading = false;
  let storySlugManuallyEdited = false;
  let passwordSetupRecovery = false;
  const adminCacheTtl = 30_000;
  const tabCache = {
    events: { loadedAt: 0, request: null },
    stories: { loadedAt: 0, request: null },
    admins: { loadedAt: 0, request: null },
    registrations: new Map(),
  };

  const invalidateEventsCache = () => {
    tabCache.events.loadedAt = 0;
    tabCache.registrations.clear();
  };
  const invalidateStoriesCache = () => { tabCache.stories.loadedAt = 0; };
  const invalidateAdminsCache = () => { tabCache.admins.loadedAt = 0; };

  const statusLabels = {
    draft: "Draf",
    open: "Dibuka",
    full: "Penuh",
    closed: "Ditutup",
    completed: "Selesai",
    cancelled: "Dibatalkan",
  };

  const registrationStatusLabels = {
    applied: "Menunggu seleksi",
    pending_payment: "Menunggu pembayaran",
    confirmed: "Terkonfirmasi",
    waitlisted: "Cadangan",
    rejected: "Tidak lolos",
    cancelled: "Dibatalkan",
    expired: "Kedaluwarsa",
  };

  const paymentStatusLabels = {
    not_required: "Tidak perlu bayar",
    unpaid: "Belum dibayar",
    pending: "Diproses",
    paid: "Lunas",
    failed: "Gagal",
    expired: "Kedaluwarsa",
    refunded: "Dikembalikan",
  };

  const adminRoleLabels = {
    admin: "Admin",
    super_admin: "Super Admin",
  };

  const storyStatusLabels = {
    draft: "Draf",
    published: "Terbit",
  };

  const statusTone = (status) => ({
    open: "is-positive",
    confirmed: "is-positive",
    paid: "is-positive",
    not_required: "is-positive",
    pending_payment: "is-pending",
    applied: "is-pending",
    waitlisted: "is-pending",
    unpaid: "is-pending",
    pending: "is-pending",
    full: "is-neutral",
    closed: "is-neutral",
    completed: "is-neutral",
    draft: "is-neutral",
    cancelled: "is-negative",
    rejected: "is-negative",
    failed: "is-negative",
    expired: "is-negative",
    refunded: "is-neutral",
  }[status] || "is-neutral");

  const setFeedback = (element, message = "", type = "") => {
    element.textContent = message;
    element.className = `feedback${type ? ` is-${type}` : ""}`;
  };

  const readSession = () => {
    try { return JSON.parse(localStorage.getItem(CONFIG.sessionKey)); }
    catch { return null; }
  };

  const saveSession = (session) => {
    const stored = { ...session, expires_at: Date.now() + Number(session.expires_in || 3600) * 1000 };
    localStorage.setItem(CONFIG.sessionKey, JSON.stringify(stored));
    return stored;
  };

  const clearSession = () => localStorage.removeItem(CONFIG.sessionKey);

  const authRequest = async (path, body, token = "") => {
    const response = await fetch(`${CONFIG.supabaseUrl}/auth/v1/${path}`, {
      method: "POST",
      headers: {
        apikey: CONFIG.publishableKey,
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.msg || data.message || "Autentikasi gagal.");
    return data;
  };

  const resetPasswordForEmail = (email) => {
    const redirectTo = `${window.location.origin}/admin/`;
    return authRequest(`recover?redirect_to=${encodeURIComponent(redirectTo)}`, { email });
  };

  const validAccessToken = async () => {
    let session = readSession();
    if (!session?.access_token || !session?.refresh_token) return null;
    if (Number(session.expires_at) - Date.now() > 60_000) return session.access_token;
    try {
      session = saveSession(await authRequest("token?grant_type=refresh_token", { refresh_token: session.refresh_token }));
      return session.access_token;
    } catch {
      clearSession();
      return null;
    }
  };

  const authorizedRequest = async (url, options = {}) => {
    const token = await validAccessToken();
    if (!token) throw new Error("Sesi berakhir. Silakan masuk kembali.");
    const response = await fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      clearSession();
      showLogin("Sesi tidak valid atau akun ini belum diberi akses admin.");
      throw new Error("Akses admin tidak diizinkan.");
    }
    if (!response.ok) {
      const error = new Error(data.error?.message || "Permintaan belum dapat diproses.");
      error.code = data.error?.code || "";
      throw error;
    }
    return data;
  };

  const adminRequest = (method = "GET", slug = "", body, action = "") => {
    const url = new URL(adminEventsUrl);
    if (slug) url.searchParams.set("slug", slug);
    if (action) url.searchParams.set("action", action);
    return authorizedRequest(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  };

  const registrationRequest = (params) => {
    const url = new URL(adminRegistrationsUrl);
    Object.entries(params).forEach(([key, value]) => { if (value) url.searchParams.set(key, value); });
    return authorizedRequest(url, { method: "GET" });
  };

  const applicantProofRequest = (registrationCode) => {
    const url = new URL(adminRegistrationsUrl);
    url.searchParams.set("proof", registrationCode);
    return authorizedRequest(url, { method: "GET" });
  };

  const selectionDecisionRequest = (registration_codes, decision) => authorizedRequest(adminRegistrationsUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ registration_codes, decision }),
  });

  const certificatesRequest = (method = "GET", { id = "", body, form } = {}) => {
    const url = new URL(adminCertificatesUrl);
    if (id) url.searchParams.set("id", id);
    return authorizedRequest(url, {
      method,
      // FormData sets its own multipart boundary header.
      ...(form ? { body: form } : body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
  };

  const attendanceRequest = (registration_codes, attended) => authorizedRequest(adminRegistrationsUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ registration_codes, attended }),
  });

  const adminUsersRequest = (method = "GET", body) => authorizedRequest(adminUsersUrl, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  const adminStoriesRequest = (method = "GET", slug = "", body, action = "") => {
    const url = new URL(adminStoriesUrl);
    if (slug) url.searchParams.set("slug", slug);
    if (action) url.searchParams.set("action", action);
    return authorizedRequest(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  };

  const sessionUserId = () => {
    try {
      const token = readSession()?.access_token?.split(".")[1];
      if (!token) return "";
      const normalized = token.replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
      return typeof payload.sub === "string" ? payload.sub : "";
    } catch { return ""; }
  };

  const applyRole = (role) => {
    currentRole = role === "super_admin" ? "super_admin" : "admin";
    document.querySelectorAll("[data-super-admin-only]").forEach((element) => {
      element.hidden = currentRole !== "super_admin";
    });
    if (currentRole !== "super_admin" && !adminsView.hidden) showEvents();
  };

  const showLogin = (message = "") => {
    loginView.hidden = false;
    adminView.hidden = true;
    loginPanel.hidden = false;
    passwordSetupPanel.hidden = true;
    if (message) setFeedback($("#login-feedback"), message, "error");
  };

  const showPasswordSetup = (recovery = false) => {
    passwordSetupRecovery = recovery;
    loginView.hidden = false;
    adminView.hidden = true;
    loginPanel.hidden = true;
    passwordSetupPanel.hidden = false;
    $("#password-setup-eyebrow").textContent = recovery ? "Pemulihan akses admin" : "Undangan admin";
    $("#password-setup-title").textContent = recovery ? "Atur kata sandi baru" : "Buat kata sandi";
    $("#password-setup-copy").textContent = recovery
      ? "Buat kata sandi baru untuk melanjutkan ke ruang kerja admin."
      : "Selesaikan akses admin dengan membuat kata sandi untuk akun ini.";
    $("#new-password").focus();
  };

  const showAdmin = () => {
    loginView.hidden = true;
    adminView.hidden = false;
  };

  const formatDate = (date) => {
    if (!date) return "Tanggal belum diatur";
    return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" }).format(new Date(`${date}T12:00:00+07:00`));
  };

  const slugifyStoryTitle = (value) => value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 140);

  const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));

  const renderEvents = () => {
    const loading = $("#events-loading");
    const empty = $("#events-empty");
    const visibleEvents = events.filter((event) => eventArchiveFilter.value === "archived" ? event.archived_at : !event.archived_at);
    loading.hidden = true;
    empty.hidden = visibleEvents.length > 0;
    empty.textContent = visibleEvents.length ? "" : eventArchiveFilter.value === "archived" ? "Belum ada kegiatan di arsip." : "Belum ada kegiatan aktif.";
    eventsList.hidden = visibleEvents.length === 0;
    eventsList.innerHTML = visibleEvents.map((event) => `
      <article class="event-row">
        <div>
          <h2>${escapeHtml(event.title)}</h2>
          ${event.environment === "development" ? '<span class="status-token is-pending">Demo</span>' : ""}
          ${event.last_edited_at ? `<p class="event-edited">Diubah ${escapeHtml(formatDateTime(event.last_edited_at))}${event.last_edited_by ? ` oleh <span title="${escapeHtml(event.last_edited_by)}">${escapeHtml(event.last_edited_by.split("@")[0])}</span>` : ""}</p>` : ""}
        </div>
        <div class="event-meta">
          <span class="data-group"><span class="data-label">Jadwal</span><span>${escapeHtml(formatDate(event.event_date))}</span></span>
          <span class="data-group"><span class="data-label">Lokasi</span><span>${escapeHtml(event.location || "Lokasi belum diatur")}</span></span>
        </div>
        <div class="event-state">
          <span class="data-group"><span class="data-label">Status</span><strong class="status-token ${statusTone(event.status)}">${escapeHtml(statusLabels[event.status] || event.status)}</strong></span>
          <span class="data-group"><span class="data-label">Publikasi</span><span class="state-label${event.is_public ? " is-public" : ""}">${event.is_public ? "Tampil di website" : "Tidak ditampilkan"}</span></span>
        </div>
        <div class="row-actions">
          <button class="edit-button" type="button" data-edit-slug="${escapeHtml(event.slug)}" aria-label="Edit ${escapeHtml(event.title)}">Edit</button>
          <button class="edit-button archive-button" type="button" data-event-archive="${escapeHtml(event.slug)}">${event.archived_at ? "Pulihkan" : "Arsipkan"}</button>
          ${event.archived_at ? `<button class="edit-button delete-button" type="button" data-event-delete="${escapeHtml(event.slug)}">Hapus permanen</button>` : ""}
        </div>
      </article>
    `).join("");
    const eventFilter = $("#registration-event-filter");
    const currentFilter = eventFilter.value;
    // Archived events stay out of the filter; their registrants are hidden too (see admin-registrations).
    eventFilter.innerHTML = `<option value="">Semua kegiatan</option>${events.filter((event) => !event.archived_at).map((event) =>
      `<option value="${escapeHtml(event.slug)}">${escapeHtml(event.title)}</option>`).join("")}`;
    eventFilter.value = currentFilter;
  };

  const loadEvents = async () => {
    const cached = tabCache.events;
    if (cached.loadedAt) {
      renderEvents();
      if (Date.now() - cached.loadedAt < adminCacheTtl) return;
    }
    if (cached.request) return cached.request;
    $("#events-loading").hidden = Boolean(cached.loadedAt);
    if (!cached.loadedAt) {
      $("#events-empty").hidden = true;
      eventsList.hidden = true;
      setFeedback($("#events-feedback"));
    }
    cached.request = adminRequest()
      .then((data) => {
        applyRole(data.role);
        events = Array.isArray(data.events) ? data.events : [];
        cached.loadedAt = Date.now();
        renderEvents();
      })
      .catch((error) => {
        if (!cached.loadedAt) {
          $("#events-loading").hidden = true;
          setFeedback($("#events-feedback"), error.message, "error");
        }
      })
      .finally(() => { cached.request = null; });
    return cached.request;
  };

  const formatDateTime = (iso) => {
    if (!iso) return "-";
    return new Intl.DateTimeFormat("id-ID", {
      day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
      timeZone: "Asia/Jakarta",
    }).format(new Date(iso));
  };

  const selectedRegistrationEvent = () => events.find((event) => event.slug === $("#registration-event-filter").value) || null;
  const syncFilterReset = () => {
    const active = ["#registration-search", "#registration-event-filter", "#registration-status-filter", "#payment-status-filter"]
      .some((selector) => $(selector).value.trim() !== "");
    $("#reset-registration-filters").hidden = !active;
  };
  const selectionEnabled = () => selectedRegistrationEvent()?.registration_mode === "selection";
  // Rows get checkboxes whenever one event is chosen: for attendance (any event) and selection decisions.
  const bulkEnabled = () => Boolean(selectedRegistrationEvent());
  const todayInJakarta = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
  // Attendance can be marked from the event day on (the server checks the same rule).
  const attendanceOpen = () => {
    const eventDate = selectedRegistrationEvent()?.event_date;
    return Boolean(eventDate) && eventDate <= todayInJakarta();
  };

  const renderSelectionTools = () => {
    const tools = $("#selection-tools");
    const event = selectedRegistrationEvent();
    const active = event?.registration_mode === "selection";
    tools.hidden = !active;
    if (!active) {
      selectionOverview = null;
      return;
    }
    const counts = selectionOverview?.counts || {};
    const accepted = Number(counts.accepted) || 0;
    const capacity = event.capacity === null || event.capacity === undefined ? "∞" : event.capacity;
    $("#selection-summary").textContent = `Diterima ${accepted}/${capacity} · Cadangan ${Number(counts.waitlisted) || 0} · Tidak lolos ${Number(counts.rejected) || 0} · Menunggu ${Number(counts.applied) || 0}`;
    const announcement = $("#selection-announcement");
    const announcementAt = event.announcement_at ? new Date(event.announcement_at) : null;
    if (!announcementAt || Number.isNaN(announcementAt.getTime())) announcement.textContent = "Waktu pengumuman belum ditentukan.";
    else announcement.textContent = Date.now() < announcementAt.getTime()
      ? `Hasil belum terlihat oleh pendaftar · diumumkan ${formatDateTime(event.announcement_at)}`
      : `Hasil sudah terlihat oleh pendaftar sejak ${formatDateTime(event.announcement_at)}`;
    $("#selection-select-all").checked = false;
  };

  const renderRegistrations = (total) => {
    $("#registrations-loading").hidden = true;
    $("#registrations-empty").hidden = registrations.length > 0;
    registrationsList.hidden = registrations.length === 0;
    $("#registrations-total").textContent = String(total);
    $(registrationLifecycle === "active" ? "#active-registrations-total" : "#history-registrations-total").textContent = String(total);
    const isSelectionEvent = selectionEnabled();
    const isBulk = bulkEnabled();
    const head = $("#registrations-head");
    head.hidden = registrations.length === 0;
    head.classList.toggle("is-selection", isBulk);
    head.querySelector(".registration-select-all").hidden = !isBulk;
    // One header row names the columns, so rows carry values only (dense, easy to scan).
    registrationsList.innerHTML = registrations.map((registration) => {
      const linkedEvent = registration.events || {};
      const registrationStatus = registration.payment_expired ? "expired" : registration.registration_status;
      const paymentStatus = registration.payment_expired ? "expired" : registration.payment_status;
      const historyCount = Number(selectionOverview?.history?.[registration.registration_code]) || 0;
      const selectionStatus = isSelectionEvent && registrationStatus === "confirmed"
        ? "Diterima" : registrationStatusLabels[registrationStatus] || registrationStatus;
      const showPayment = paymentStatus && paymentStatus !== "not_required";
      return `
        <article class="registration-row${isBulk ? " is-selection-row" : ""}" data-registration-code="${escapeHtml(registration.registration_code)}">
          ${isBulk ? `<label class="registration-select"><input type="checkbox" data-applicant-select value="${escapeHtml(registration.registration_code)}" aria-label="Pilih ${escapeHtml(registration.name)}" /></label>` : ""}
          <div class="registration-person">
            <strong class="registration-name">${escapeHtml(registration.name)}</strong>
            <span class="registration-sub">${escapeHtml(registration.email)}</span>
            ${isSelectionEvent && registration.selection_answer ? `<span class="selection-answer-text">${escapeHtml(registration.selection_answer)}</span>` : ""}
          </div>
          <div class="registration-event">
            <span class="registration-event-title">${escapeHtml(linkedEvent.title || "Kegiatan tidak ditemukan")}</span>
            <span class="registration-sub registration-code">${escapeHtml(registration.registration_code)}</span>
          </div>
          <div class="registration-state">
            <span class="status-token ${statusTone(registrationStatus)}">${escapeHtml(selectionStatus)}</span>
            ${showPayment ? `<span class="registration-sub registration-payment ${statusTone(paymentStatus)}">${escapeHtml(paymentStatusLabels[paymentStatus] || paymentStatus)}</span>` : ""}
            ${registration.attended_at && registrationStatus === "confirmed" ? '<span class="attendance-token">Hadir</span>' : ""}
            ${isSelectionEvent ? `<span class="applicant-history">${historyCount ? `Pernah ikut ${historyCount}×` : "Peserta baru"}</span>` : ""}
          </div>
          <div class="registration-date">
            <time datetime="${escapeHtml(registration.created_at)}">${escapeHtml(formatDateTime(registration.created_at))}</time>
            ${registration.payment_expired && registration.payment_deadline ? `<span class="registration-sub">Batas bayar ${escapeHtml(formatDateTime(registration.payment_deadline))}</span>` : ""}
          </div>
          <button class="text-button applicant-detail-button" type="button" data-applicant-detail="${escapeHtml(registration.registration_code)}" aria-label="Lihat detail ${escapeHtml(registration.name)}">Detail</button>
        </article>
      `;
    }).join("");
    renderSelectionTools();
    const confirmedRows = registrations.filter((item) => item.registration_status === "confirmed" && !item.payment_expired);
    const attendedRows = confirmedRows.filter((item) => item.attended_at).length;
    const attendanceSummary = $("#attendance-summary");
    attendanceSummary.hidden = !isBulk;
    // Counted from the rows shown, so say so when a search or status filter narrows them.
    const narrowed = ["#registration-search", "#registration-status-filter", "#payment-status-filter"]
      .some((selector) => $(selector).value.trim() !== "");
    attendanceSummary.textContent = ` · Hadir ${attendedRows} dari ${confirmedRows.length} terkonfirmasi${narrowed ? " (sesuai filter)" : ""}`;
    document.querySelectorAll("[data-selection-bulk]").forEach((button) => { button.hidden = !isSelectionEvent; });
    const selectAll = $("#selection-select-all");
    selectAll.checked = false;
    syncSelectionDecisionControls();
    $("#registrations-export").disabled = registrations.length === 0;
    syncSelectionBar();
  };

  // The bulk command bar only appears while rows are selected ("3 dipilih · Terima · Cadangan · Tolak").
  const syncSelectionBar = () => {
    const boxes = [...registrationsList.querySelectorAll("[data-applicant-select]")];
    const checked = boxes.filter((box) => box.checked).length;
    $("#selection-commandbar").hidden = checked === 0;
    $("#selection-count").textContent = `${checked} dipilih`;
    const selectAll = $("#selection-select-all");
    selectAll.checked = boxes.length > 0 && checked === boxes.length;
    selectAll.indeterminate = checked > 0 && checked < boxes.length;
  };

  let registrationLoadSeq = 0;
  const loadRegistrations = async () => {
    const loadSeq = ++registrationLoadSeq;
    syncFilterReset();
    const params = {
      event: $("#registration-event-filter").value,
      lifecycle: registrationLifecycle,
      search: $("#registration-search").value.trim(),
      registration_status: $("#registration-status-filter").value,
      payment_status: $("#payment-status-filter").value,
    };
    const cacheKey = JSON.stringify(params);
    const cached = tabCache.registrations.get(cacheKey);
    if (cached) {
      registrations = cached.registrations;
      selectionOverview = cached.selection || null;
      renderRegistrations(cached.total);
      if (Date.now() - cached.loadedAt < adminCacheTtl) return;
    }
    const inflight = tabCache.registrations.get(`${cacheKey}:request`);
    if (inflight) {
      // Same filters already loading (started by an older call): render its result for this call.
      return inflight.then(() => {
        const loaded = tabCache.registrations.get(cacheKey);
        if (loadSeq !== registrationLoadSeq || !loaded) return;
        registrations = loaded.registrations;
        selectionOverview = loaded.selection || null;
        renderRegistrations(loaded.total);
      });
    }
    $("#registrations-loading").hidden = Boolean(cached);
    if (!cached) {
      $("#registrations-empty").hidden = true;
      registrationsList.hidden = true;
      // Never keep a bulk selection alive for rows that are being replaced.
      registrationsList.querySelectorAll("[data-applicant-select]").forEach((checkbox) => { checkbox.checked = false; });
      syncSelectionBar();
      setFeedback($("#registrations-feedback"));
    }
    const request = registrationRequest(params)
      .then((data) => {
        const loadedRegistrations = Array.isArray(data.registrations) ? data.registrations : [];
        const loadedSelection = data.selection || null;
        const total = Number(data.total) || 0;
        tabCache.registrations.set(cacheKey, { registrations: loadedRegistrations, total, selection: loadedSelection, loadedAt: Date.now() });
        // Typing fires several searches; only the latest one may render.
        if (loadSeq !== registrationLoadSeq) return undefined;
        registrations = loadedRegistrations;
        selectionOverview = loadedSelection;
        renderRegistrations(total);
        const otherLifecycle = registrationLifecycle === "active" ? "history" : "active";
        const otherParams = { ...params, lifecycle: otherLifecycle };
        return registrationRequest(otherParams).then((otherData) => {
          $(`#${otherLifecycle}-registrations-total`).textContent = String(Number(otherData.total) || 0);
        }).catch(() => undefined);
      })
      .catch((error) => {
        if (loadSeq !== registrationLoadSeq) return;
        if (!cached) {
          $("#registrations-loading").hidden = true;
          setFeedback($("#registrations-feedback"), error.message, "error");
        }
      })
      .finally(() => tabCache.registrations.delete(`${cacheKey}:request`));
    tabCache.registrations.set(`${cacheKey}:request`, request);
    return request;
  };

  const applicantDialog = $("#applicant-dialog");
  const applicantDialogContent = $("#applicant-dialog-content");
  // The detail panel is grouped by task: Seleksi (for selection events), Data pendaftar, Kegiatan & pembayaran.
  let applicantGroup = null;
  let applicantShownAt = 0;
  const startApplicantGroup = (title, className = "") => {
    const group = document.createElement("section");
    group.className = `applicant-group ${className}`.trim();
    const heading = document.createElement("h3");
    heading.className = "applicant-group-title";
    heading.textContent = title;
    const fields = document.createElement("div");
    fields.className = "applicant-group-fields";
    group.append(heading, fields);
    applicantDialogContent.append(group);
    applicantGroup = fields;
  };
  const appendApplicantField = (label, value, { wide = false } = {}) => {
    const item = document.createElement("div");
    item.className = `applicant-detail-field${wide ? " is-wide" : ""}`;
    const heading = document.createElement("h4");
    heading.textContent = label;
    const content = document.createElement("p");
    content.textContent = value || "-";
    item.append(heading, content);
    (applicantGroup || applicantDialogContent).append(item);
  };

  const externalLink = (href, text) => {
    const link = document.createElement("a");
    link.className = "text-button";
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.referrerPolicy = "no-referrer";
    link.textContent = text;
    return link;
  };
  // Filled in two steps: the portfolio link is in the row; the CV link needs a signed URL.
  const appendApplicantCvField = (applicant) => {
    const item = document.createElement("div");
    item.className = "applicant-detail-field applicant-cv-field is-wide";
    const heading = document.createElement("h4");
    heading.textContent = "CV / portofolio";
    const links = document.createElement("p");
    links.className = "applicant-file-links";
    let portfolio = null;
    try { portfolio = applicant.portfolio_url ? new URL(applicant.portfolio_url) : null; } catch { portfolio = null; }
    if (portfolio?.protocol === "https:") links.append(externalLink(portfolio.href, "Buka link portofolio"));
    else links.textContent = "-";
    item.append(heading, links);
    (applicantGroup || applicantDialogContent).append(item);
  };

  const currentDialogApplicant = () => registrations[applicantDialogIndex] || null;
  const loadApplicantProof = async (registration) => {
    if (registration?.events?.registration_mode !== "selection") return;
    try {
      const result = await applicantProofRequest(registration.registration_code);
      if (currentDialogApplicant()?.registration_code !== registration.registration_code) return;
      const signedHref = (file) => {
        if (!file?.signed_url) return null;
        const url = new URL(file.signed_url);
        if (url.origin !== new URL(CONFIG.supabaseUrl).origin) throw new Error("Berkas pendaftar tidak dapat dibuka.");
        return url.href;
      };
      const proofHref = signedHref(result.proof);
      const cvHref = signedHref(result.cv);
      const cvLinks = applicantDialogContent.querySelector(".applicant-cv-field .applicant-file-links");
      if (cvHref && cvLinks && !cvLinks.querySelector("[data-cv-link]")) {
        if (!cvLinks.querySelector("a")) cvLinks.textContent = "";
        const cvLink = externalLink(cvHref, "Lihat CV (PDF)");
        cvLink.dataset.cvLink = "";
        cvLinks.prepend(cvLink);
      }
      if (!proofHref) return;
      const signedUrl = new URL(proofHref);
      const section = document.createElement("div");
      section.className = "applicant-detail-field applicant-proof-field is-wide";
      const heading = document.createElement("h4");
      heading.textContent = "Bukti follow Instagram";
      const previewLink = externalLink(signedUrl.href, "Lihat bukti");
      const image = document.createElement("img");
      image.className = "applicant-proof-preview";
      image.src = signedUrl.href;
      image.alt = "Screenshot bukti follow Instagram peserta";
      image.referrerPolicy = "no-referrer";
      section.append(heading, previewLink, image);
      // A quick back-and-forth to the same applicant can resolve two requests for one render.
      applicantDialogContent.querySelector(".applicant-proof-field")?.remove();
      (applicantDialogContent.querySelector(".applicant-group-selection .applicant-group-fields") || applicantDialogContent).append(section);
    } catch (error) {
      if (currentDialogApplicant()?.registration_code === registration.registration_code) {
        setFeedback($("#applicant-dialog-feedback"), error.message || "Berkas pendaftar belum dapat dibuka.", "error");
      }
    }
  };
  const syncSelectionDecisionControls = () => {
    const applicant = currentDialogApplicant();
    const status = applicant?.payment_expired ? "expired" : applicant?.registration_status;
    const isSelectionApplicant = applicant?.events?.registration_mode === "selection";
    applicantDialog.querySelectorAll("[data-applicant-decision]").forEach((button) => {
      button.disabled = selectionDecisionPending
        || (isSelectionApplicant && button.dataset.applicantDecision === (status === "confirmed" ? "accepted" : status));
    });
    document.querySelectorAll("[data-selection-bulk]").forEach((button) => { button.disabled = selectionDecisionPending; });
    document.querySelectorAll("[data-attendance-bulk]").forEach((button) => {
      button.disabled = selectionDecisionPending || !attendanceOpen();
      button.title = attendanceOpen() ? "" : "Kehadiran baru bisa ditandai mulai hari kegiatan.";
    });
    const selectAll = $("#selection-select-all");
    selectAll.disabled = selectionDecisionPending || registrations.length === 0 || !bulkEnabled();
  };
  const renderApplicantDialog = () => {
    const applicant = currentDialogApplicant();
    if (!applicant) return;
    const event = applicant.events || {};
    const status = applicant.payment_expired ? "expired" : applicant.registration_status;
    const isSelectionEvent = event.registration_mode === "selection";
    const statusLabel = isSelectionEvent && status === "confirmed" ? "Diterima" : registrationStatusLabels[status] || status;
    $("#applicant-dialog-title").textContent = applicant.name || "Pendaftar";
    const statusToken = $("#applicant-dialog-status");
    statusToken.className = `status-token ${statusTone(status)}`;
    statusToken.textContent = statusLabel;
    $("#applicant-dialog-code").textContent = applicant.registration_code;
    $("#applicant-dialog-position").textContent = `${applicantDialogIndex + 1} / ${registrations.length}`;
    applicantShownAt = performance.now();
    applicantDialogContent.replaceChildren();
    applicantGroup = null;
    if (isSelectionEvent) {
      startApplicantGroup("Seleksi", "applicant-group-selection");
      appendApplicantField("Pertanyaan seleksi", applicant.selection_question, { wide: true });
      appendApplicantField("Jawaban seleksi", applicant.selection_answer, { wide: true });
      appendApplicantField("Komitmen", applicant.commitment_text, { wide: true });
      appendApplicantField("Riwayat seleksi", Number(selectionOverview?.history?.[applicant.registration_code])
        ? `Pernah ikut ${selectionOverview.history[applicant.registration_code]}×` : "Peserta baru");
      appendApplicantField("Keputusan seleksi", applicant.selection_decided_at
        ? formatDateTime(applicant.selection_decided_at) : "Belum diputuskan");
      appendApplicantCvField(applicant);
      void loadApplicantProof(applicant);
    }
    startApplicantGroup("Data pendaftar");
    appendApplicantField("Email", applicant.email);
    appendApplicantField("WhatsApp", applicant.phone);
    appendApplicantField("Domisili", applicant.domicile);
    appendApplicantField("Instansi", applicant.institution);
    appendApplicantField("Definisi bahagia", applicant.reason, { wide: true });
    if (applicant.notes) appendApplicantField("Catatan tambahan", applicant.notes, { wide: true });
    appendApplicantField("Terdaftar", formatDateTime(applicant.created_at));
    startApplicantGroup("Kegiatan & pembayaran");
    appendApplicantField("Kegiatan", event.title, { wide: true });
    appendApplicantField("Tanggal kegiatan", event.event_date ? formatDate(event.event_date) : "-");
    const paymentStatus = applicant.payment_expired ? "expired" : applicant.payment_status;
    appendApplicantField("Pembayaran", paymentStatus === "not_required"
      ? "Tidak perlu bayar" : paymentStatusLabels[paymentStatus] || paymentStatus || "-");
    if (applicant.payment_deadline && paymentStatus !== "not_required") {
      appendApplicantField("Batas pembayaran", formatDateTime(applicant.payment_deadline));
    }
    if (status === "confirmed") {
      appendApplicantField("Kehadiran", applicant.attended_at ? `Hadir · ditandai ${formatDateTime(applicant.attended_at)}` : "Belum ditandai hadir");
    }
    const outcomes = isSelectionEvent && ["confirmed", "waitlisted", "rejected"].includes(status);
    applicantDialog.querySelector(".applicant-selection-actions").hidden = !isSelectionEvent;
    syncSelectionDecisionControls();
    const waButton = applicantDialog.querySelector("[data-applicant-whatsapp]");
    waButton.hidden = !outcomes;
    applicantDialog.querySelector(".applicant-dialog-footer").hidden = !outcomes;
    applicantDialog.querySelector('[data-applicant-nav="previous"]').disabled = applicantDialogIndex <= 0;
    applicantDialog.querySelector('[data-applicant-nav="next"]').disabled = applicantDialogIndex >= registrations.length - 1;
    setFeedback($("#applicant-dialog-feedback"));
  };

  const showApplicant = (registrationCode) => {
    applicantDialogIndex = registrations.findIndex((item) => item.registration_code === registrationCode);
    if (applicantDialogIndex < 0) return;
    renderApplicantDialog();
    if (!applicantDialog.open) applicantDialog.showModal();
  };

  const moveApplicant = (offset) => {
    const nextIndex = applicantDialogIndex + offset;
    if (nextIndex < 0 || nextIndex >= registrations.length) return;
    applicantDialogIndex = nextIndex;
    renderApplicantDialog();
    applicantDialog.querySelector(".applicant-dialog-panel").scrollTop = 0;
  };

  const refreshRegistrations = async () => {
    tabCache.registrations.clear();
    await loadRegistrations();
  };

  const decideApplicants = async (codes, decision, { advance = false } = {}) => {
    const current = currentDialogApplicant();
    const allowedContext = applicantDialog.open
      ? current?.events?.registration_mode === "selection"
      : selectionEnabled();
    const feedback = applicantDialog.open ? $("#applicant-dialog-feedback") : $("#registrations-feedback");
    if (!allowedContext) {
      setFeedback(feedback, "Keputusan hanya tersedia untuk pendaftar kegiatan mode Seleksi.", "error");
      return;
    }
    if (!codes.length) {
      setFeedback(feedback, "Pilih setidaknya satu pendaftar.", "error");
      return;
    }
    const nextApplicant = advance
      ? registrations.slice(applicantDialogIndex + 1).find((applicant) => applicant.events?.registration_mode === "selection")
      : null;
    const nextCode = nextApplicant?.registration_code || null;
    setFeedback(feedback, "Menyimpan keputusan…");
    selectionDecisionPending = true;
    syncSelectionDecisionControls();
    try {
      const result = await selectionDecisionRequest(codes, decision);
      selectionOverview = result.selection || selectionOverview;
      $("#selection-select-all").checked = false;
      try {
        await refreshRegistrations();
      } catch (refreshError) {
        setFeedback(feedback, `Keputusan tersimpan, tapi daftar belum bisa diperbarui: ${refreshError.message}`, "error");
        return;
      }
      setFeedback($("#registrations-feedback"), "Keputusan berhasil disimpan.", "success");
      if (advance && applicantDialog.open) {
        if (nextCode && registrations.some((item) => item.registration_code === nextCode)) showApplicant(nextCode);
        else if (current && registrations.some((item) => item.registration_code === current.registration_code)) showApplicant(current.registration_code);
        else applicantDialog.close();
      } else if (applicantDialog.open && current) {
        const refreshed = registrations.find((item) => item.registration_code === current.registration_code);
        if (refreshed) showApplicant(refreshed.registration_code);
      }
    } catch (error) {
      if (error.code === "CAPACITY_EXCEEDED") {
        setFeedback(feedback, error.message, "error");
        try { await refreshRegistrations(); } catch { /* Keep the capacity error visible. */ }
      } else setFeedback(feedback, error.message, "error");
    } finally {
      selectionDecisionPending = false;
      syncSelectionDecisionControls();
    }
  };

  const markAttendance = async (codes, attended) => {
    const feedback = $("#registrations-feedback");
    if (!codes.length) return setFeedback(feedback, "Pilih setidaknya satu pendaftar.", "error");
    setFeedback(feedback, attended ? "Menandai hadir…" : "Membatalkan tanda hadir…");
    selectionDecisionPending = true;
    syncSelectionDecisionControls();
    try {
      const { attendance = {} } = await attendanceRequest(codes, attended);
      const changed = Number(attendance.changed) || 0;
      const skipped = Number(attendance.skipped) || 0;
      const unchanged = Number(attendance.unchanged) || 0;
      const parts = [`${changed} pendaftar ${attended ? "ditandai hadir" : "dibatalkan tanda hadirnya"}`];
      if (unchanged) parts.push(`${unchanged} sudah ${attended ? "hadir" : "tidak bertanda hadir"} sebelumnya`);
      if (skipped) parts.push(`${skipped} dilewati karena belum terkonfirmasi`);
      $("#selection-select-all").checked = false;
      try {
        await refreshRegistrations();
      } catch (refreshError) {
        setFeedback(feedback, `Kehadiran tersimpan, tapi daftar belum bisa diperbarui: ${refreshError.message}`, "error");
        return;
      }
      setFeedback(feedback, `${parts.join(" · ")}.`, "success");
    } catch (error) {
      setFeedback(feedback, error.message, "error");
    } finally {
      selectionDecisionPending = false;
      syncSelectionDecisionControls();
    }
  };

  const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const exportRegistrationsCsv = () => {
    const columns = ["Kode", "Nama", "Email", "WhatsApp", "Domisili", "Instansi", "Definisi bahagia", "Jawaban seleksi", "Link portofolio", "Status", "Hadir", "Terdaftar"];
    const rows = registrations.map((applicant) => [
      applicant.registration_code, applicant.name, applicant.email, applicant.phone, applicant.domicile,
      applicant.institution, applicant.reason, applicant.selection_answer, applicant.portfolio_url,
      selectionEnabled() && applicant.registration_status === "confirmed"
        ? "Diterima" : registrationStatusLabels[applicant.registration_status] || applicant.registration_status,
      applicant.attended_at && applicant.registration_status === "confirmed" ? "Ya" : "",
      formatDateTime(applicant.created_at),
    ]);
    const csv = `\uFEFF${[columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `pendaftar-${selectedRegistrationEvent()?.slug || "kegiatan"}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const DEFAULT_WA_MESSAGES = {
    accepted: "Halo {nama}, selamat! Kamu diterima di kegiatan {kegiatan} pada {tanggal}. Kode pendaftaran: {kode}. Gabung grup peserta: {link_grup}. Cek hasil: {link_status}",
    waitlisted: "Halo {nama}, saat ini kamu masuk daftar cadangan kegiatan {kegiatan} pada {tanggal}. Kode pendaftaran: {kode}. Kami akan menghubungi jika ada perubahan. Cek hasil: {link_status}",
    rejected: "Halo {nama}, terima kasih sudah mendaftar kegiatan {kegiatan} pada {tanggal}. Kali ini kamu belum terpilih. Semoga ada kesempatan bertemu di kegiatan berikutnya. Cek hasil: {link_status}",
  };
  const normalizeWhatsApp = (phone) => {
    let digits = String(phone || "").replace(/\D/g, "");
    if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
    else if (digits.startsWith("8")) digits = `62${digits}`;
    return digits.startsWith("62") ? digits : "";
  };
  const sendApplicantWhatsApp = () => {
    const applicant = currentDialogApplicant();
    const status = applicant?.registration_status;
    const outcome = status === "confirmed" ? "accepted" : status;
    if (!applicant || !["accepted", "waitlisted", "rejected"].includes(outcome)) return;
    const phone = normalizeWhatsApp(applicant.phone);
    if (!phone) return setFeedback($("#applicant-dialog-feedback"), "Nomor WhatsApp tidak valid.", "error");
    const event = events.find((item) => item.slug === applicant.events?.slug) || {};
    const date = event.event_date ? formatDate(event.event_date) : "tanggal kegiatan";
    const groupLink = event.whatsapp_group_url || "(link grup menyusul)";
    const statusLink = `${window.location.origin}/cek-status.html?kode=${encodeURIComponent(applicant.registration_code)}`;
    const template = event[`wa_message_${outcome}`] || DEFAULT_WA_MESSAGES[outcome];
    const message = template.replace(/\{(nama|kegiatan|tanggal|kode|link_grup|link_status)\}/g, (_, key) => ({
      nama: applicant.name || "", kegiatan: event.title || applicant.events?.title || "", tanggal: date,
      kode: applicant.registration_code, link_grup: groupLink, link_status: statusLink,
    })[key]);
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  };

  registrationsList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-applicant-detail]");
    if (button) {
      showApplicant(button.dataset.applicantDetail);
      return;
    }
    // The whole row opens the detail panel, except its checkbox and other controls.
    if (event.target.closest("input, label, a, button, select, textarea")) return;
    const row = event.target.closest(".registration-row");
    if (row && !window.getSelection()?.toString()) showApplicant(row.dataset.registrationCode);
  });
  registrationsList.addEventListener("change", (event) => {
    if (event.target.matches("[data-applicant-select]")) syncSelectionBar();
  });
  $("#selection-select-all").addEventListener("change", (event) => {
    registrationsList.querySelectorAll("[data-applicant-select]").forEach((checkbox) => { checkbox.checked = event.currentTarget.checked; });
    syncSelectionBar();
  });
  $("#selection-clear").addEventListener("click", () => {
    registrationsList.querySelectorAll("[data-applicant-select]").forEach((checkbox) => { checkbox.checked = false; });
    syncSelectionBar();
  });
  document.querySelectorAll("[data-selection-bulk]").forEach((button) => button.addEventListener("click", () => {
    const codes = [...registrationsList.querySelectorAll("[data-applicant-select]:checked")].map((checkbox) => checkbox.value);
    void decideApplicants(codes, button.dataset.selectionBulk);
  }));
  document.querySelectorAll("[data-attendance-bulk]").forEach((button) => button.addEventListener("click", () => {
    const codes = [...registrationsList.querySelectorAll("[data-applicant-select]:checked")].map((checkbox) => checkbox.value);
    void markAttendance(codes, button.dataset.attendanceBulk === "true");
  }));
  $("#registrations-export").addEventListener("click", exportRegistrationsCsv);
  applicantDialog.querySelector(".applicant-dialog-close").addEventListener("click", () => applicantDialog.close());
  applicantDialog.addEventListener("click", (event) => { if (event.target === applicantDialog) applicantDialog.close(); });
  applicantDialog.querySelectorAll("[data-applicant-nav]").forEach((button) => button.addEventListener("click", () => moveApplicant(button.dataset.applicantNav === "previous" ? -1 : 1)));
  applicantDialog.querySelectorAll("[data-applicant-decision]").forEach((button) => button.addEventListener("click", () => {
    const applicant = currentDialogApplicant();
    if (applicant) void decideApplicants([applicant.registration_code], button.dataset.applicantDecision, { advance: true });
  }));
  applicantDialog.querySelector("[data-applicant-whatsapp]").addEventListener("click", sendApplicantWhatsApp);
  document.addEventListener("keydown", (event) => {
    if (!applicantDialog.open || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (event.key === "ArrowLeft") { event.preventDefault(); moveApplicant(-1); }
    else if (event.key === "ArrowRight") { event.preventDefault(); moveApplicant(1); }
    else if (!event.shiftKey && !event.repeat && performance.now() - applicantShownAt > 600) {
      // Selection shortcuts: T = Terima, C = Cadangan, X = Tolak (same as clicking the enabled button).
      // Held keys and the first moments after moving to a new applicant are ignored so nobody is decided unseen.
      const decision = { t: "accepted", c: "waitlisted", x: "rejected" }[event.key.toLowerCase()];
      const button = decision && applicantDialog.querySelector(`.applicant-selection-actions:not([hidden]) [data-applicant-decision="${decision}"]`);
      if (button && !button.disabled) { event.preventDefault(); button.click(); }
    }
  });

  const renderAdmins = () => {
    const currentUserId = sessionUserId();
    $("#admins-loading").hidden = true;
    $("#admins-empty").hidden = admins.length > 0;
    adminsList.hidden = admins.length === 0;
    adminsList.innerHTML = admins.map((admin) => {
      const isSelf = admin.user_id === currentUserId;
      const activeLabel = admin.is_active ? "Aktif" : "Dinonaktifkan";
      return `
        <form class="admin-row" data-admin-id="${escapeHtml(admin.user_id)}">
          <div class="admin-identity">
            <span class="data-label">Admin</span>
            <strong>${escapeHtml(admin.email)}</strong>
            <span>Ditambahkan ${escapeHtml(formatDateTime(admin.created_at))}${isSelf ? " · Akun kamu" : ""}</span>
          </div>
          <label>Peran
            <select name="role" aria-label="Peran ${escapeHtml(admin.email)}">
              <option value="admin"${admin.role === "admin" ? " selected" : ""}>Admin</option>
              <option value="super_admin"${admin.role === "super_admin" ? " selected" : ""}>Super Admin</option>
            </select>
          </label>
          <span class="admin-access-state">
            <span class="data-label">Status akses</span>
            <span class="status-token ${admin.is_active ? "is-positive" : "is-neutral"}">${activeLabel}</span>
          </span>
          <span class="admin-row-actions">
            <button class="button button-secondary" type="submit">Simpan peran</button>
            <button class="button button-secondary" type="button" data-toggle-admin data-next-active="${admin.is_active ? "false" : "true"}"${isSelf && admin.is_active ? " disabled title=\"Akun sendiri tidak dapat dinonaktifkan\"" : ""}>${admin.is_active ? "Nonaktifkan" : "Aktifkan"}</button>
            <button class="button button-secondary" type="button" data-send-recovery>Kirim ulang akses</button>
            <button class="button button-secondary" type="button" data-generate-access-link>Salin tautan akses</button>
          </span>
        </form>
      `;
    }).join("");
  };

  const loadAdmins = async () => {
    const cached = tabCache.admins;
    if (cached.loadedAt) {
      renderAdmins();
      if (Date.now() - cached.loadedAt < adminCacheTtl) return;
    }
    if (cached.request) return cached.request;
    $("#admins-loading").hidden = Boolean(cached.loadedAt);
    if (!cached.loadedAt) {
      $("#admins-empty").hidden = true;
      adminsList.hidden = true;
      setFeedback($("#admins-feedback"));
    }
    cached.request = adminUsersRequest()
      .then((data) => {
        admins = Array.isArray(data.admins) ? data.admins : [];
        cached.loadedAt = Date.now();
        renderAdmins();
      })
      .catch((error) => {
        if (!cached.loadedAt) {
          $("#admins-loading").hidden = true;
          setFeedback($("#admins-feedback"), error.message, "error");
        }
      })
      .finally(() => { cached.request = null; });
    return cached.request;
  };

  const renderStories = () => {
    const visibleStories = stories.filter((story) => storyArchiveFilter.value === "archived" ? story.archived_at : !story.archived_at);
    $("#stories-loading").hidden = true;
    $("#stories-empty").hidden = visibleStories.length > 0;
    $("#stories-empty").textContent = visibleStories.length ? "" : storyArchiveFilter.value === "archived" ? "Belum ada kisah di arsip." : "Belum ada kisah aktif.";
    storiesList.hidden = visibleStories.length === 0;
    storiesList.innerHTML = visibleStories.map((story) => `
      <article class="story-row">
        <div class="story-row-copy">
          <span class="data-label">Judul</span>
          <h2>${escapeHtml(story.title)}</h2>
          <span>${escapeHtml(story.slug)}</span>
        </div>
        <span class="data-group">
          <span class="data-label">Status</span>
          <span class="status-token ${story.status === "published" ? "is-positive" : "is-neutral"}">${escapeHtml(storyStatusLabels[story.status] || story.status)}</span>
        </span>
        <span class="story-row-meta">
          <span class="data-label">Tanggal terbit</span>
          <time${story.published_at ? ` datetime="${escapeHtml(story.published_at)}"` : ""}>${escapeHtml(story.published_at ? formatDateTime(story.published_at) : "Belum diterbitkan")}</time>
        </span>
        <div class="row-actions">
          <button class="edit-button" type="button" data-edit-story="${escapeHtml(story.slug)}" aria-label="Edit kisah ${escapeHtml(story.title)}">Edit</button>
          <button class="edit-button archive-button" type="button" data-story-archive="${escapeHtml(story.slug)}">${story.archived_at ? "Pulihkan" : "Arsipkan"}</button>
          ${story.archived_at ? `<button class="edit-button delete-button" type="button" data-story-delete="${escapeHtml(story.slug)}">Hapus permanen</button>` : ""}
        </div>
      </article>
    `).join("");
  };

  const loadStories = async () => {
    const cached = tabCache.stories;
    if (cached.loadedAt) {
      renderStories();
      if (Date.now() - cached.loadedAt < adminCacheTtl) return;
    }
    if (cached.request) return cached.request;
    $("#stories-loading").hidden = Boolean(cached.loadedAt);
    if (!cached.loadedAt) {
      $("#stories-empty").hidden = true;
      storiesList.hidden = true;
      setFeedback($("#stories-feedback"));
    }
    cached.request = adminStoriesRequest()
      .then((data) => {
        stories = Array.isArray(data.stories) ? data.stories : [];
        cached.loadedAt = Date.now();
        renderStories();
      })
      .catch((error) => {
        if (!cached.loadedAt) {
          $("#stories-loading").hidden = true;
          setFeedback($("#stories-feedback"), error.message, "error");
        }
      })
      .finally(() => { cached.request = null; });
    return cached.request;
  };

  const toLocalDateTime = (iso) => {
    if (!iso) return "";
    const parts = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(new Date(iso));
    return parts.replace(" ", "T");
  };

  const toIso = (value) => value ? new Date(`${value}:00+07:00`).toISOString() : null;
  // end_at is one timestamp; the form splits it into an optional end date (multi-day events) and an end time.
  const endAtFromForm = () => {
    const endDate = $("#event-end-date").value;
    const endTime = $("#event-end-time").value;
    if (!endDate && !endTime) return null;
    return toIso(`${endDate || $("#event-date").value}T${endTime || "23:59"}`);
  };
  const endAtError = () => {
    const endAt = endAtFromForm();
    if (!endAt || !$("#event-date").value) return "";
    const startAt = toIso(`${$("#event-date").value}T${$("#event-start-time").value || "00:00"}`);
    return new Date(endAt) <= new Date(startAt) ? "Waktu selesai harus setelah waktu mulai." : "";
  };
  const splitLines = (value) => value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);

  const setImagePreview = (url = "") => {
    const preview = $("#event-image-preview");
    const image = $("#event-image-preview-img");
    const status = $("#image-upload-status");
    status.classList.remove("is-error");
    $("#event-image-file").removeAttribute("aria-invalid");
    if (!url) {
      preview.hidden = true;
      image.removeAttribute("src");
      status.textContent = "Belum ada foto dipilih.";
      return;
    }
    image.src = url;
    preview.hidden = false;
    status.textContent = "Foto siap digunakan.";
  };

  // Photos are shrunk in the browser before upload, so a 4 MB phone photo or a PNG
  // poster from Canva is stored as a ~200 KB WebP that is still sharp on screen.
  const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
  const encodeCanvas = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  const compressImage = async (file, maxWidth, maxHeight) => {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      throw new Error("Foto tidak dapat dibaca. Coba simpan ulang sebagai JPG atau PNG.");
    }
    const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    let blob = await encodeCanvas(canvas, "image/webp", 0.82);
    if (!blob || blob.type !== "image/webp") {
      // Browsers without WebP encoding (older Safari) get JPEG; paint transparency white, not black.
      context.globalCompositeOperation = "destination-over";
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      blob = await encodeCanvas(canvas, "image/jpeg", 0.85);
    }
    if (!blob) throw new Error("Foto belum dapat diproses.");
    // An already small, already sized file is kept as it is.
    return scale === 1 && file.size <= blob.size && file.size <= MAX_UPLOAD_BYTES ? file : blob;
  };

  const uploadImage = async (file, { bucket, slugInput, maxWidth, maxHeight }) => {
    const allowedTypes = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
    if (!allowedTypes[file.type]) throw new Error("Gunakan file JPG, PNG, atau WebP.");
    if (file.size > MAX_SOURCE_BYTES) throw new Error("Ukuran foto maksimal 25 MB.");
    const image = await compressImage(file, maxWidth, maxHeight);
    if (image.size > MAX_UPLOAD_BYTES) throw new Error("Foto masih terlalu besar setelah dikompres. Coba foto lain.");
    const extension = allowedTypes[image.type];

    const token = await validAccessToken();
    if (!token) throw new Error("Sesi berakhir. Silakan masuk kembali.");
    const slug = $(slugInput).value.trim().toLowerCase();
    const folder = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : "draft";
    const objectPath = `${folder}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
    const response = await fetch(`${CONFIG.supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`, {
      method: "POST",
      headers: {
        apikey: CONFIG.publishableKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": image.type,
        "x-upsert": "false",
      },
      body: image,
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      throw new Error("Akun ini tidak memiliki izin upload foto.");
    }
    if (!response.ok) throw new Error(data.message || data.error || "Foto belum dapat diunggah.");
    const publicPath = objectPath.split("/").map(encodeURIComponent).join("/");
    return `${CONFIG.supabaseUrl}/storage/v1/object/public/${bucket}/${publicPath}`;
  };

  // Event photos are mostly 4:5 posters; 1200x1500 stays sharp in the poster dialog.
  const uploadEventImage = (file) => uploadImage(file, {
    bucket: "event-images", slugInput: "#event-slug", maxWidth: 1200, maxHeight: 1500,
  });

  const setStoryImagePreview = (url = "") => {
    const preview = $("#story-image-preview");
    const image = $("#story-image-preview-img");
    const status = $("#story-image-upload-status");
    status.classList.remove("is-error");
    $("#story-image-file").removeAttribute("aria-invalid");
    if (!url) {
      preview.hidden = true;
      image.removeAttribute("src");
      status.textContent = "Belum ada foto dipilih.";
      return;
    }
    image.src = url;
    preview.hidden = false;
    status.textContent = "Foto siap digunakan.";
  };

  // Story covers run wide on the Kisah pages.
  const uploadStoryImage = (file) => uploadImage(file, {
    bucket: "story-images", slugInput: "#story-slug", maxWidth: 1600, maxHeight: 1600,
  });

  // Seat-hold window only matters for paid events; values set outside the preset
  // list (e.g. via SQL) are kept as an extra option instead of being lost.
  const setPaymentWindow = (minutes) => {
    const select = $("#event-payment-window");
    select.querySelectorAll("option[data-custom]").forEach((option) => option.remove());
    const value = String(minutes);
    if (![...select.options].some((option) => option.value === value)) {
      const option = new Option(`${value} menit`, value);
      option.dataset.custom = "true";
      select.append(option);
    }
    select.value = value;
  };
  const togglePaymentWindowField = () => {
    $("#event-payment-window-field").hidden = Number($("#event-price").value) <= 0;
  };

  // Starting values for a new selection event; the owner can rewrite them per event.
  const SELECTION_DEFAULTS = {
    question: "Kenapa kamu ingin ikut kegiatan ini?",
    minChars: 150,
    commitment: "Saya bersedia hadir penuh sesuai jadwal kegiatan.",
    requirements: [
      "Membawa donasi bahagia **mulai dari Rp5.000** sebagai dukungan untuk kegiatan volunteer gratis bersama Kita Bahagia.",
      "Membawa **snack rencengan/kotakan** berisi 10+ untuk dibagikan kepada adik-adik.",
      "Mengunggah momen kegiatan volunteer Kita Bahagia di **Feeds/Reels**. Sebagai bentuk apresiasi, peserta akan mendapatkan **sertifikat** kegiatan.",
    ],
    applicantsPerSeat: 4,
    waAccepted: "Halo {nama}, selamat! Kamu diterima di kegiatan {kegiatan} pada {tanggal}. Kode pendaftaran: {kode}. Gabung grup peserta: {link_grup}. Cek hasil: {link_status}",
    waWaitlisted: "Halo {nama}, saat ini kamu masuk daftar cadangan kegiatan {kegiatan} pada {tanggal}. Kode pendaftaran: {kode}. Kami akan menghubungi jika ada perubahan. Cek hasil: {link_status}",
    waRejected: "Halo {nama}, terima kasih sudah mendaftar kegiatan {kegiatan} pada {tanggal}. Kali ini kamu belum terpilih. Semoga ada kesempatan bertemu di kegiatan berikutnya. Cek hasil: {link_status}",
  };
  const toggleSelectionFields = () => {
    const selection = $("#event-registration-mode").value === "selection";
    document.querySelectorAll("[data-selection-only]").forEach((field) => { field.hidden = !selection; });
  };
  const applySelectionDefaults = () => {
    if ($("#event-registration-mode").value !== "selection") return;
    const capacity = Number($("#event-capacity").value);
    if (!$("#event-applicant-limit").value && capacity > 0) {
      $("#event-applicant-limit").value = capacity * SELECTION_DEFAULTS.applicantsPerSeat;
    }
    if (!$("#event-selection-question").value.trim()) $("#event-selection-question").value = SELECTION_DEFAULTS.question;
    if (!$("#event-selection-min").value) $("#event-selection-min").value = SELECTION_DEFAULTS.minChars;
    if (!$("#event-commitment").value.trim()) $("#event-commitment").value = SELECTION_DEFAULTS.commitment;
    if (!$("#event-wa-accepted").value.trim()) $("#event-wa-accepted").value = SELECTION_DEFAULTS.waAccepted;
    if (!$("#event-wa-waitlisted").value.trim()) $("#event-wa-waitlisted").value = SELECTION_DEFAULTS.waWaitlisted;
    if (!$("#event-wa-rejected").value.trim()) $("#event-wa-rejected").value = SELECTION_DEFAULTS.waRejected;
  };

  const fillForm = (event = null) => {
    eventForm.reset();
    $("#form-title").textContent = event ? "Edit Kegiatan" : "Tambah Kegiatan";
    $("#original-slug").value = event?.slug || "";
    $("#event-title").value = event?.title || "";
    $("#event-slug").value = event?.slug || "";
    $("#event-category").value = event?.category || "";
    $("#event-category-key").value = event?.category_key || "";
    $("#event-description").value = event?.description || "";
    $("#event-registration-description").value = event?.registration_description || "";
    $("#event-date").value = event?.event_date || "";
    $("#event-start-time").value = event?.start_time?.slice(0, 5) || "";
    const [endDate = "", endTime = ""] = toLocalDateTime(event?.end_at).split("T");
    $("#event-end-date").value = endDate && endDate !== event?.event_date ? endDate : "";
    $("#event-end-time").value = endTime;
    $("#event-deadline").value = toLocalDateTime(event?.registration_deadline);
    $("#event-location").value = event?.location || "";
    $("#event-location-url").value = event?.location_url || "";
    $("#event-price").value = event?.price ?? 0;
    $("#event-capacity").value = event?.capacity ?? "";
    setPaymentWindow(event?.payment_window_minutes ?? 15);
    togglePaymentWindowField();
    $("#event-registration-mode").value = event?.registration_mode || "first_come";
    $("#event-opens-at").value = toLocalDateTime(event?.registration_opens_at);
    $("#event-applicant-limit").value = event?.applicant_limit ?? "";
    $("#event-announcement-at").value = toLocalDateTime(event?.announcement_at);
    $("#event-selection-question").value = event?.selection_question || "";
    $("#event-selection-min").value = event?.registration_mode === "selection" ? event.selection_min_chars ?? "" : "";
    $("#event-commitment").value = event?.commitment_text || "";
    $("#event-requirements").value = event?.selection_requirements?.join("\n") || "";
    $("#event-cv-requested").checked = Boolean(event?.cv_requested);
    $("#event-cv-note").value = event?.cv_note || "";
    $("#event-wa-accepted").value = event?.wa_message_accepted || "";
    $("#event-wa-waitlisted").value = event?.wa_message_waitlisted || "";
    $("#event-wa-rejected").value = event?.wa_message_rejected || "";
    toggleSelectionFields();
    if (event?.registration_mode === "selection") applySelectionDefaults();
    $("#event-activities").value = event?.activities?.join("\n") || "";
    $("#event-benefits").value = event?.benefits?.join("\n") || "";
    $("#event-image-url").value = event?.image_url || "";
    $("#event-image-file").value = "";
    setImagePreview(event?.image_url || "");
    $("#event-image-alt").value = event?.image_alt || "";
    $("#event-whatsapp").value = event?.whatsapp_group_url || "";
    $("#event-status").value = event?.status || "draft";
    $("#event-public").checked = Boolean(event?.is_public);
    setFeedback($("#form-feedback"));
  };

  const showForm = (event = null) => {
    fillForm(event);
    eventsView.hidden = true;
    registrationsView.hidden = true;
    adminsView.hidden = true;
    certificatesView.hidden = true;
    storiesView.hidden = true;
    storyFormView.hidden = true;
    formView.hidden = false;
    window.scrollTo({ top: 0, behavior: "instant" });
    $("#event-title").focus();
  };

  const showEvents = () => {
    formView.hidden = true;
    registrationsView.hidden = true;
    adminsView.hidden = true;
    certificatesView.hidden = true;
    storiesView.hidden = true;
    storyFormView.hidden = true;
    eventsView.hidden = false;
    setActiveNavigation("events");
    window.scrollTo({ top: 0, behavior: "instant" });
    $("#add-event-button").focus();
    void loadEvents();
  };

  const setActiveNavigation = (view) => {
    document.querySelectorAll("[data-admin-view]").forEach((link) => {
      const active = link.dataset.adminView === view;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  };

  const showRegistrations = async () => {
    formView.hidden = true;
    eventsView.hidden = true;
    adminsView.hidden = true;
    certificatesView.hidden = true;
    storiesView.hidden = true;
    storyFormView.hidden = true;
    registrationsView.hidden = false;
    setActiveNavigation("registrations");
    window.scrollTo({ top: 0, behavior: "instant" });
    if (!tabCache.events.loadedAt) await loadEvents();
    await loadRegistrations();
  };

  const showAdmins = async () => {
    if (currentRole !== "super_admin") return showEvents();
    formView.hidden = true;
    eventsView.hidden = true;
    registrationsView.hidden = true;
    storiesView.hidden = true;
    storyFormView.hidden = true;
    adminsView.hidden = false;
    certificatesView.hidden = true;
    setActiveNavigation("admins");
    window.scrollTo({ top: 0, behavior: "instant" });
    await loadAdmins();
  };

  const fillStoryForm = (story = null) => {
    storyForm.reset();
    storySlugManuallyEdited = !!story; // editing = slug already set; new = allow auto-gen
    $("#story-form-title").textContent = story ? "Edit Kisah" : "Tambah Kisah";
    $("#original-story-slug").value = story?.slug || "";
    $("#story-title").value = story?.title || "";
    $("#story-slug").value = story?.slug || "";
    $("#story-excerpt").value = story?.excerpt || "";
    $("#story-body").value = story?.body || "";
    $("#story-image-url").value = story?.cover_image_url || "";
    $("#story-image-file").value = "";
    setStoryImagePreview(story?.cover_image_url || "");
    $("#story-image-alt").value = story?.cover_image_alt || "";
    $("#story-status").value = story?.status || "draft";
    $("#story-published-at").value = toLocalDateTime(story?.published_at);
    setFeedback($("#story-form-feedback"));

    // Slug help — warn when editing an already-published story
    const slugHelp = $("#story-slug-help");
    if (slugHelp) {
      if (story?.status === "published") {
        slugHelp.classList.add("field-help-warning");
        slugHelp.textContent = "Mengubah alamat artikel dapat membuat tautan lama tidak berfungsi.";
      } else {
        slugHelp.classList.remove("field-help-warning");
        slugHelp.textContent = "Dibuat dari judul dan digunakan sebagai alamat unik artikel di website.";
      }
    }
  };

  const showStoryForm = (story = null) => {
    fillStoryForm(story);
    eventsView.hidden = true;
    formView.hidden = true;
    registrationsView.hidden = true;
    adminsView.hidden = true;
    certificatesView.hidden = true;
    storiesView.hidden = true;
    storyFormView.hidden = false;
    window.scrollTo({ top: 0, behavior: "instant" });
    $("#story-title").focus();
  };

  const showStories = async () => {
    eventsView.hidden = true;
    formView.hidden = true;
    registrationsView.hidden = true;
    adminsView.hidden = true;
    certificatesView.hidden = true;
    storyFormView.hidden = true;
    storiesView.hidden = false;
    setActiveNavigation("stories");
    window.scrollTo({ top: 0, behavior: "instant" });
    await loadStories();
  };

  const prefetchAdminTabs = () => {
    window.setTimeout(() => {
      void loadStories();
      if (currentRole === "super_admin") void loadAdmins();
    }, 0);
  };

  const formPayload = () => ({
    title: $("#event-title").value.trim(),
    slug: $("#event-slug").value.trim().toLowerCase(),
    description: $("#event-description").value.trim() || null,
    registration_description: $("#event-registration-description").value.trim() || null,
    activities: splitLines($("#event-activities").value),
    benefits: splitLines($("#event-benefits").value),
    category: $("#event-category").value.trim() || null,
    category_key: $("#event-category-key").value.trim() || null,
    event_date: $("#event-date").value,
    start_time: $("#event-start-time").value || null,
    end_at: endAtFromForm(),
    timezone: "Asia/Jakarta",
    location: $("#event-location").value.trim() || null,
    location_url: $("#event-location-url").value.trim() || null,
    price: Number($("#event-price").value),
    capacity: $("#event-capacity").value ? Number($("#event-capacity").value) : null,
    payment_window_minutes: Number($("#event-payment-window").value),
    registration_deadline: toIso($("#event-deadline").value),
    status: $("#event-status").value,
    image_url: $("#event-image-url").value.trim() || null,
    image_alt: $("#event-image-alt").value.trim() || null,
    whatsapp_group_url: $("#event-whatsapp").value.trim() || null,
    is_public: $("#event-public").checked,
    registration_mode: $("#event-registration-mode").value,
    registration_opens_at: toIso($("#event-opens-at").value),
    applicant_limit: $("#event-applicant-limit").value ? Number($("#event-applicant-limit").value) : null,
    announcement_at: toIso($("#event-announcement-at").value),
    selection_question: $("#event-selection-question").value.trim() || null,
    selection_min_chars: Number($("#event-selection-min").value) || 0,
    commitment_text: $("#event-commitment").value.trim() || null,
    selection_requirements: splitLines($("#event-requirements").value),
    cv_requested: $("#event-cv-requested").checked,
    cv_note: $("#event-cv-note").value.trim() || null,
    wa_message_accepted: $("#event-wa-accepted").value.trim() || null,
    wa_message_waitlisted: $("#event-wa-waitlisted").value.trim() || null,
    wa_message_rejected: $("#event-wa-rejected").value.trim() || null,
  });

  const storyFormPayload = () => ({
    title: $("#story-title").value.trim(),
    slug: $("#story-slug").value.trim().toLowerCase(),
    excerpt: $("#story-excerpt").value.trim() || null,
    body: $("#story-body").value.trim(),
    cover_image_url: $("#story-image-url").value.trim() || null,
    cover_image_alt: $("#story-image-alt").value.trim() || null,
    status: $("#story-status").value,
    published_at: toIso($("#story-published-at").value),
  });

  const authCallbackParams = () => {
    const hash = window.location.hash.startsWith("#")
      ? new URLSearchParams(window.location.hash.slice(1))
      : new URLSearchParams();
    if ([...hash.keys()].length) return hash;
    return new URLSearchParams(window.location.search);
  };

  const clearAuthCallback = () => window.history.replaceState(null, "", window.location.pathname);

  const readInviteSession = () => {
    const params = authCallbackParams();
    if ((params.get("type") || "").toLowerCase() !== "invite") return false;
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (!accessToken || !refreshToken) {
      clearSession();
      clearAuthCallback();
      showLogin();
      setFeedback($("#login-feedback"), "Tautan undangan tidak lengkap atau sudah tidak berlaku. Minta Super Admin mengirim ulang akses.", "error");
      return true;
    }
    saveSession({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: Number(params.get("expires_in")) || 3600,
      token_type: params.get("token_type") || "bearer",
    });
    clearAuthCallback();
    showPasswordSetup();
    return true;
  };

  const readRecoverySession = () => {
    const params = authCallbackParams();
    const type = (params.get("type") || "").toLowerCase();
    if (!["recovery", "password_recovery"].includes(type)) return false;
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (!accessToken || !refreshToken) {
      clearSession();
      clearAuthCallback();
      showLogin();
      setFeedback($("#login-feedback"), "Tautan pemulihan tidak lengkap atau sudah tidak berlaku. Minta tautan baru melalui Lupa kata sandi.", "error");
      return true;
    }
    saveSession({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: Number(params.get("expires_in")) || 3600,
      token_type: params.get("token_type") || "bearer",
    });
    clearAuthCallback();
    showPasswordSetup(true);
    return true;
  };

  const readAuthError = () => {
    const params = authCallbackParams();
    if (!params.has("error") && !params.has("error_code") && !params.has("error_description")) return false;
    clearSession();
    clearAuthCallback();
    showLogin();
    setFeedback($("#login-feedback"), "Tautan akses sudah tidak berlaku. Minta tautan baru melalui Lupa kata sandi.", "error");
    return true;
  };

  const updatePassword = async (password) => {
    const token = await validAccessToken();
    if (!token) throw new Error(passwordSetupRecovery
      ? "Tautan pemulihan sudah tidak berlaku. Minta Super Admin mengirim ulang akses."
      : "Tautan undangan sudah tidak berlaku. Minta Super Admin mengirim undangan baru.");
    const response = await fetch(`${CONFIG.supabaseUrl}/auth/v1/user`, {
      method: "PUT",
      headers: {
        apikey: CONFIG.publishableKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.msg || data.message || "Kata sandi belum dapat disimpan.");
  };

  $("#event-price").addEventListener("input", togglePaymentWindowField);
  $("#event-registration-mode").addEventListener("change", () => {
    applySelectionDefaults();
    // Only on switching to Seleksi, so an owner can still save an empty list.
    if ($("#event-registration-mode").value === "selection" && !$("#event-requirements").value.trim()) {
      $("#event-requirements").value = SELECTION_DEFAULTS.requirements.join("\n");
    }
    toggleSelectionFields();
  });

  $("#event-image-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const button = $("#save-button");
    const status = $("#image-upload-status");
    imageUploading = true;
    button.disabled = true;
    status.classList.remove("is-error");
    event.target.removeAttribute("aria-invalid");
    status.textContent = "Mengompres dan mengunggah foto…";
    try {
      const publicUrl = await uploadEventImage(file);
      $("#event-image-url").value = publicUrl;
      setImagePreview(publicUrl);
    } catch (error) {
      event.target.value = "";
      event.target.setAttribute("aria-invalid", "true");
      status.classList.add("is-error");
      status.textContent = error.message;
    } finally {
      imageUploading = false;
      button.disabled = false;
    }
  });

  $("#story-image-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const button = $("#save-story-button");
    const status = $("#story-image-upload-status");
    storyImageUploading = true;
    button.disabled = true;
    status.classList.remove("is-error");
    event.target.removeAttribute("aria-invalid");
    status.textContent = "Mengompres dan mengunggah foto…";
    try {
      const publicUrl = await uploadStoryImage(file);
      $("#story-image-url").value = publicUrl;
      setStoryImagePreview(publicUrl);
    } catch (error) {
      event.target.value = "";
      event.target.setAttribute("aria-invalid", "true");
      status.classList.add("is-error");
      status.textContent = error.message;
    } finally {
      storyImageUploading = false;
      button.disabled = false;
    }
  });

  // Auto-generate slug from title for new stories (skip if user has typed a manual slug)
  $("#story-title").addEventListener("input", () => {
    if (storySlugManuallyEdited) return;
    $("#story-slug").value = slugifyStoryTitle($("#story-title").value);
  });

  // Once the user touches the slug field, stop overwriting it
  $("#story-slug").addEventListener("input", () => {
    storySlugManuallyEdited = true;
  });

  // Sertifikat → signer list. Signatures are photos of pen on white paper: the paper is made
  // transparent in the browser, so only the ink (PNG) is uploaded to the private bucket.
  const signerRoleLabels = { founder: "Founder", project_leader: "Project Leader", partner: "Mitra kolaborasi" };
  const signerDefaultTitles = { founder: "Founder Kita Bahagia", project_leader: "Project Leader", partner: "" };
  const signerInk = { signature: null, stamp: null };
  const signerReads = { signature: 0, stamp: 0 };
  let signers = [];
  let signerPending = false;

  const extractInk = async (file) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Gunakan foto JPG, PNG, atau WebP.");
    if (file.size > MAX_SOURCE_BYTES) throw new Error("Ukuran foto maksimal 25 MB.");
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      throw new Error("Foto tidak dapat dibaca. Coba simpan ulang sebagai JPG atau PNG.");
    }
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const work = document.createElement("canvas");
    work.width = width;
    work.height = height;
    const context = work.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const image = context.getImageData(0, 0, width, height);
    const pixels = image.data;
    // Paper brightness = a high percentile of luminance, so ink and shadows do not skew it.
    const histogram = new Uint32Array(256);
    for (let index = 0; index < pixels.length; index += 4) {
      const luminance = pixels[index + 3] < 10 ? 255 : Math.round(0.299 * pixels[index] + 0.587 * pixels[index + 1] + 0.114 * pixels[index + 2]);
      histogram[luminance] += 1;
    }
    let paper = 255;
    for (let level = 0, seen = 0; level < 256; level += 1) {
      seen += histogram[level];
      if (seen >= width * height * 0.75) { paper = level; break; }
    }
    const high = Math.max(60, paper - 18);
    const low = Math.max(0, high - 90);
    let minX = width; let minY = height; let maxX = -1; let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const luminance = 0.299 * pixels[index] + 0.587 * pixels[index + 1] + 0.114 * pixels[index + 2];
        const ink = luminance >= high ? 0 : luminance <= low ? 1 : (high - luminance) / (high - low);
        const alpha = Math.round(ink * pixels[index + 3]);
        if (alpha > 0) {
          // Remove the paper tint from half-transparent edges so the ink does not get a grey halo.
          for (let channel = 0; channel < 3; channel += 1) {
            pixels[index + channel] = Math.max(0, Math.min(255, Math.round((pixels[index + channel] - paper * (1 - ink)) / ink)));
          }
        }
        pixels[index + 3] = alpha;
        if (alpha > 40) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) throw new Error("Tanda tangan tidak terbaca. Pakai pulpen gelap di kertas putih polos.");
    context.putImageData(image, 0, 0);
    const pad = 12;
    const sx = Math.max(0, minX - pad); const sy = Math.max(0, minY - pad);
    const sw = Math.min(width, maxX + pad + 1) - sx; const sh = Math.min(height, maxY + pad + 1) - sy;
    let fit = Math.min(1, 1200 / Math.max(sw, sh));
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const out = document.createElement("canvas");
      out.width = Math.max(1, Math.round(sw * fit));
      out.height = Math.max(1, Math.round(sh * fit));
      const outContext = out.getContext("2d");
      outContext.imageSmoothingQuality = "high";
      outContext.drawImage(work, sx, sy, sw, sh, 0, 0, out.width, out.height);
      const blob = await encodeCanvas(out, "image/png");
      if (blob && blob.size <= 1024 * 1024) return { canvas: out, blob };
      fit *= 0.7;
    }
    throw new Error("Foto tanda tangan terlalu besar. Coba foto yang lebih dekat.");
  };

  const syncSignerForm = () => {
    const role = $("#signer-role").value;
    $("#signer-organization-field").hidden = role !== "partner";
    $("#signer-stamp-field").hidden = role !== "founder";
    if (role !== "founder" && (signerInk.stamp || $("#signer-stamp-file").value)) {
      $("#signer-stamp-file").value = "";
      signerInk.stamp = null;
      signerReads.stamp += 1;
    }
    const preview = $("#signer-preview");
    preview.hidden = !signerInk.signature;
    $("#signer-preview-title").textContent = $("#signer-title").value.trim() || "Jabatan";
    $("#signer-preview-name").textContent = $("#signer-name").value.trim() || "Nama";
    const ink = $("#signer-preview-ink");
    ink.replaceChildren();
    if (signerInk.stamp) {
      signerInk.stamp.canvas.className = "signer-stamp";
      ink.append(signerInk.stamp.canvas);
    }
    if (signerInk.signature) {
      signerInk.signature.canvas.className = "signer-signature";
      ink.append(signerInk.signature.canvas);
    }
    $("#signer-submit").disabled = signerPending;
  };

  const readSignerFile = async (input, key) => {
    const feedback = $("#signer-form-feedback");
    const file = input.files?.[0];
    // A slower, older photo must not overwrite a newer pick (or a stamp cleared by a role change).
    const read = ++signerReads[key];
    signerInk[key] = null;
    syncSignerForm();
    if (!file) return;
    setFeedback(feedback, "Memproses foto…");
    try {
      const ink = await extractInk(file);
      if (read !== signerReads[key]) return;
      signerInk[key] = ink;
      setFeedback(feedback);
    } catch (error) {
      if (read !== signerReads[key]) return;
      input.value = "";
      setFeedback(feedback, error.message, "error");
    }
    syncSignerForm();
  };

  const renderSigners = () => {
    $("#signers-loading").hidden = true;
    $("#signers-empty").hidden = signers.length > 0;
    const list = $("#signers-list");
    list.hidden = signers.length === 0;
    list.innerHTML = signers.map((signer) => `
      <article class="signer-row${signer.is_active ? "" : " is-inactive"}">
        <div class="signer-block">
          <span class="signer-block-title">${escapeHtml(signer.title)}</span>
          <div class="signer-ink">
            ${signer.stamp_url ? `<img class="signer-stamp" src="${escapeHtml(signer.stamp_url)}" alt="" referrerpolicy="no-referrer" />` : ""}
            ${signer.signature_url ? `<img class="signer-signature" src="${escapeHtml(signer.signature_url)}" alt="Tanda tangan ${escapeHtml(signer.name)}" referrerpolicy="no-referrer" />` : "<span class=\"registration-sub\">Gambar belum dapat dimuat</span>"}
          </div>
          <span class="signer-block-name">${escapeHtml(signer.name)}</span>
        </div>
        <div class="signer-meta">
          <strong>${escapeHtml(signer.name)}</strong>
          <span>${escapeHtml(signerRoleLabels[signer.role] || signer.role)}${signer.organization ? ` · ${escapeHtml(signer.organization)}` : ""}</span>
          <span class="registration-sub">Ditambahkan ${escapeHtml(formatDateTime(signer.created_at))} oleh ${escapeHtml(String(signer.created_by || "").split("@")[0])}</span>
          ${signer.is_active ? "" : "<span class=\"status-token is-negative\">Nonaktif</span>"}
        </div>
        <button class="button button-secondary" type="button" data-toggle-signer="${escapeHtml(signer.id)}" data-signer-active="${signer.is_active ? "false" : "true"}"${signerPending ? " disabled" : ""}>${signer.is_active ? "Nonaktifkan" : "Aktifkan lagi"}</button>
      </article>
    `).join("");
  };

  const loadSigners = async () => {
    const feedback = $("#signers-feedback");
    $("#signers-loading").hidden = signers.length > 0;
    setFeedback(feedback);
    try {
      const data = await certificatesRequest();
      signers = Array.isArray(data.signers) ? data.signers : [];
      renderSigners();
    } catch (error) {
      $("#signers-loading").hidden = true;
      setFeedback(feedback, error.message, "error");
    }
  };

  const showCertificates = async () => {
    formView.hidden = true;
    eventsView.hidden = true;
    registrationsView.hidden = true;
    storiesView.hidden = true;
    storyFormView.hidden = true;
    adminsView.hidden = true;
    certificatesView.hidden = false;
    setActiveNavigation("certificates");
    window.scrollTo({ top: 0, behavior: "instant" });
    // Signed preview URLs last 10 minutes, so the list is fetched fresh on every visit.
    await loadSigners();
  };

  let signerTitleEdited = false;
  $("#signer-title").addEventListener("input", () => { signerTitleEdited = true; syncSignerForm(); });
  $("#signer-name").addEventListener("input", syncSignerForm);
  $("#signer-role").addEventListener("change", () => {
    if (!signerTitleEdited) $("#signer-title").value = signerDefaultTitles[$("#signer-role").value] || "";
    syncSignerForm();
  });
  $("#signer-signature-file").addEventListener("change", (event) => { void readSignerFile(event.currentTarget, "signature"); });
  $("#signer-stamp-file").addEventListener("change", (event) => { void readSignerFile(event.currentTarget, "stamp"); });
  $("#signer-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const signerForm = event.currentTarget;
    const feedback = $("#signer-form-feedback");
    const role = $("#signer-role").value;
    const name = $("#signer-name").value.trim();
    const title = $("#signer-title").value.trim();
    const organization = $("#signer-organization").value.trim();
    const problem = name.length < 2 ? "Isi nama lengkap penanda tangan."
      : title.length < 2 ? "Isi jabatan yang dicetak di sertifikat."
        : role === "partner" && organization.length < 2 ? "Isi nama organisasi mitra."
          : !signerInk.signature ? "Pilih foto tanda tangan."
            : !$("#signer-consent").checked ? "Centang izin dari pemilik tanda tangan." : "";
    if (problem) return setFeedback(feedback, problem, "error");
    const form = new FormData();
    form.append("name", name);
    form.append("role", role);
    form.append("title", title);
    if (role === "partner") form.append("organization", organization);
    form.append("consent", "true");
    form.append("signature", new File([signerInk.signature.blob], "signature.png", { type: "image/png" }));
    if (role === "founder" && signerInk.stamp) form.append("stamp", new File([signerInk.stamp.blob], "stamp.png", { type: "image/png" }));
    signerPending = true;
    syncSignerForm();
    setFeedback(feedback, "Menyimpan tanda tangan…");
    try {
      const data = await certificatesRequest("POST", { form });
      if (Array.isArray(data.signers)) signers = data.signers;
      else void loadSigners();
      signerForm.reset();
      signerInk.signature = null;
      signerInk.stamp = null;
      signerReads.signature += 1;
      signerReads.stamp += 1;
      signerTitleEdited = false;
      $("#signer-title").value = signerDefaultTitles[$("#signer-role").value];
      setFeedback(feedback, `Tanda tangan ${name} tersimpan.`, "success");
    } catch (error) {
      setFeedback(feedback, error.message, "error");
    } finally {
      signerPending = false;
      syncSignerForm();
      renderSigners();
    }
  });
  $("#signers-list").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-toggle-signer]");
    if (!button || signerPending) return;
    signerPending = true;
    renderSigners();
    const feedback = $("#signers-feedback");
    try {
      const data = await certificatesRequest("PATCH", { id: button.dataset.toggleSigner, body: { is_active: button.dataset.signerActive === "true" } });
      if (Array.isArray(data.signers)) signers = data.signers;
      else void loadSigners();
      setFeedback(feedback);
    } catch (error) {
      setFeedback(feedback, error.message, "error");
    } finally {
      signerPending = false;
      renderSigners();
    }
  });

  document.querySelectorAll("[data-admin-view]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const view = link.dataset.adminView;
      const alreadyVisible = (view === "events" && !eventsView.hidden)
        || (view === "registrations" && !registrationsView.hidden)
        || (view === "stories" && !storiesView.hidden)
        || (view === "admins" && !adminsView.hidden)
        || (view === "certificates" && !certificatesView.hidden);
      if (alreadyVisible) return;
      if (view === "certificates") showCertificates();
      else if (view === "registrations") showRegistrations();
      else if (view === "stories") showStories();
      else if (view === "admins") showAdmins();
      else showEvents();
    });
  });

  $("#registration-filters").addEventListener("submit", (event) => {
    event.preventDefault();
    loadRegistrations();
  });

  $("#reset-registration-filters").addEventListener("click", () => {
    $("#registration-filters").reset();
    loadRegistrations();
  });
  // Filters apply immediately; the search waits for a short pause in typing.
  ["#registration-event-filter", "#registration-status-filter", "#payment-status-filter"].forEach((selector) => {
    $(selector).addEventListener("change", () => loadRegistrations());
  });
  let registrationSearchTimer = 0;
  $("#registration-search").addEventListener("input", () => {
    window.clearTimeout(registrationSearchTimer);
    registrationSearchTimer = window.setTimeout(() => loadRegistrations(), 300);
  });

  document.querySelectorAll("[data-registration-lifecycle]").forEach((button) => {
    button.addEventListener("click", () => {
      registrationLifecycle = button.dataset.registrationLifecycle;
      document.querySelectorAll("[data-registration-lifecycle]").forEach((tab) => {
        const active = tab === button;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-selected", String(active));
      });
      loadRegistrations();
    });
  });

  inviteAdminForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#invite-admin-button");
    button.disabled = true;
    button.textContent = "Mengirim…";
    setFeedback($("#invite-admin-feedback"));
    try {
      if ($("#invite-admin-role").value === "super_admin" && !window.confirm("Undangan ini memberi akses Super Admin. Lanjutkan?")) return;
      await adminUsersRequest("POST", {
        email: $("#invite-admin-email").value.trim(),
        role: $("#invite-admin-role").value,
      });
      inviteAdminForm.reset();
      invalidateAdminsCache();
      setFeedback($("#invite-admin-feedback"), "Undangan admin berhasil dikirim.", "success");
      await loadAdmins();
    } catch (error) {
      setFeedback($("#invite-admin-feedback"), error.message, "error");
    } finally {
      button.disabled = false;
      button.textContent = "Kirim undangan";
    }
  });

  adminsList.addEventListener("submit", async (event) => {
    event.preventDefault();
    const row = event.target.closest("[data-admin-id]");
    if (!row) return;
    const selected = admins.find((admin) => admin.user_id === row.dataset.adminId);
    const role = row.querySelector("select[name='role']").value;
    if (!selected || role === selected.role) return setFeedback($("#admins-feedback"), "Tidak ada perubahan peran.");
    if (!window.confirm(`Ubah peran ${selected.email} menjadi ${adminRoleLabels[role]}?`)) {
      row.querySelector("select[name='role']").value = selected.role;
      return;
    }
    const button = row.querySelector("button[type='submit']");
    button.disabled = true;
    setFeedback($("#admins-feedback"));
    try {
      await adminUsersRequest("PATCH", { user_id: selected.user_id, role });
      if (selected.user_id === sessionUserId() && role !== "super_admin") {
        applyRole(role);
        showEvents();
        setFeedback($("#events-feedback"), "Peran akun kamu berhasil diperbarui.", "success");
      } else {
        invalidateAdminsCache();
        await loadAdmins();
        setFeedback($("#admins-feedback"), "Peran admin berhasil diperbarui.", "success");
      }
    } catch (error) {
      row.querySelector("select[name='role']").value = selected.role;
      setFeedback($("#admins-feedback"), error.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  adminsList.addEventListener("click", async (event) => {
    const linkButton = event.target.closest("[data-generate-access-link]");
    if (linkButton) {
      const row = linkButton.closest("[data-admin-id]");
      const selected = admins.find((admin) => admin.user_id === row?.dataset.adminId);
      if (!selected || !window.confirm(`Salin tautan akses untuk ${selected.email}?`)) return;
      linkButton.disabled = true;
      setFeedback($("#admins-feedback"));
      try {
        const data = await adminUsersRequest("PATCH", { action: "generate_access_link", user_id: selected.user_id });
        if (!data.action_link) throw new Error("Tautan akses belum dapat dibuat.");
        await navigator.clipboard.writeText(data.action_link);
        setFeedback($("#admins-feedback"), "Tautan akses berhasil disalin. Kirim langsung kepada admin yang bersangkutan.", "success");
      } catch (error) {
        setFeedback($("#admins-feedback"), error.message, "error");
      } finally {
        linkButton.disabled = false;
      }
      return;
    }
    const recoveryButton = event.target.closest("[data-send-recovery]");
    if (recoveryButton) {
      const row = recoveryButton.closest("[data-admin-id]");
      const selected = admins.find((admin) => admin.user_id === row?.dataset.adminId);
      if (!selected || !window.confirm(`Kirim ulang akses ke ${selected.email}?`)) return;
      recoveryButton.disabled = true;
      setFeedback($("#admins-feedback"));
      try {
        await adminUsersRequest("PATCH", { action: "send_access_recovery", user_id: selected.user_id });
        setFeedback($("#admins-feedback"), "Email akses baru sudah dikirim.", "success");
      } catch (error) {
        setFeedback($("#admins-feedback"), error.message, "error");
      } finally {
        recoveryButton.disabled = false;
      }
      return;
    }
    const button = event.target.closest("[data-toggle-admin]");
    if (!button || button.disabled) return;
    const row = button.closest("[data-admin-id]");
    const selected = admins.find((admin) => admin.user_id === row?.dataset.adminId);
    if (!selected) return;
    const nextActive = button.dataset.nextActive === "true";
    const action = nextActive ? "aktifkan kembali" : "nonaktifkan";
    if (!window.confirm(`${action[0].toUpperCase()}${action.slice(1)} akses ${selected.email}?`)) return;
    button.disabled = true;
    setFeedback($("#admins-feedback"));
    try {
      await adminUsersRequest("PATCH", { user_id: selected.user_id, is_active: nextActive });
      invalidateAdminsCache();
      await loadAdmins();
      setFeedback($("#admins-feedback"), `Akses admin berhasil ${nextActive ? "diaktifkan" : "dinonaktifkan"}.`, "success");
    } catch (error) {
      setFeedback($("#admins-feedback"), error.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  passwordSetupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = $("#new-password").value;
    const confirmation = $("#confirm-password").value;
    if (!password || !confirmation) return setFeedback($("#password-setup-feedback"), "Isi kedua kata sandi terlebih dahulu.", "error");
    if (password.length < 8) return setFeedback($("#password-setup-feedback"), "Kata sandi minimal 8 karakter.", "error");
    if (password !== confirmation) return setFeedback($("#password-setup-feedback"), "Kedua kata sandi belum sama.", "error");
    const button = $("#password-setup-button");
    button.disabled = true;
    button.textContent = "Menyimpan…";
    setFeedback($("#password-setup-feedback"));
    try {
      await updatePassword(password);
      passwordSetupForm.reset();
      if (passwordSetupRecovery) {
        clearSession();
        showLogin();
        setFeedback($("#login-feedback"), "Kata sandi berhasil diatur. Silakan masuk kembali.", "success");
      } else {
        showAdmin();
        await loadEvents();
        prefetchAdminTabs();
      }
    } catch (error) {
      setFeedback($("#password-setup-feedback"), error.message, "error");
    } finally {
      button.disabled = false;
      button.textContent = "Simpan kata sandi";
    }
  });

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#login-button");
    button.disabled = true;
    button.textContent = "Memeriksa…";
    setFeedback($("#login-feedback"));
    try {
      const session = await authRequest("token?grant_type=password", {
        email: $("#login-email").value.trim(), password: $("#login-password").value,
      });
      saveSession(session);
      showAdmin();
      await loadEvents();
      prefetchAdminTabs();
    } catch (error) {
      setFeedback($("#login-feedback"), error.message, "error");
    } finally {
      button.disabled = false;
      button.textContent = "Masuk";
    }
  });

  $("#forgot-password-button").addEventListener("click", async () => {
    const emailInput = $("#login-email");
    const email = emailInput.value.trim().toLowerCase();
    if (!email) {
      setFeedback($("#login-feedback"), "Masukkan email terlebih dahulu.", "error");
      emailInput.focus();
      return;
    }
    if (!emailInput.validity.valid) {
      setFeedback($("#login-feedback"), "Masukkan alamat email yang valid.", "error");
      emailInput.focus();
      return;
    }
    const button = $("#forgot-password-button");
    button.disabled = true;
    setFeedback($("#login-feedback"));
    try {
      await resetPasswordForEmail(email);
    } catch {
      // Keep recovery responses neutral so arbitrary emails are not disclosed.
    } finally {
      button.disabled = false;
      setFeedback($("#login-feedback"), "Jika email terdaftar, tautan untuk mengatur ulang kata sandi telah dikirim.", "success");
    }
  });

  eventForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (imageUploading) {
      setFeedback($("#form-feedback"), "Tunggu sampai upload foto selesai.", "error");
      return;
    }
    const scheduleError = endAtError();
    if (scheduleError) {
      setFeedback($("#form-feedback"), scheduleError, "error");
      $("#event-end-time").focus();
      return;
    }
    if ($("#event-registration-mode").value === "selection" && Number($("#event-price").value) > 0) {
      setFeedback($("#form-feedback"), "Mode seleksi hanya untuk kegiatan gratis. Ubah harga jadi 0 atau pilih mode Langsung.", "error");
      $("#event-registration-mode").focus();
      return;
    }
    const payload = formPayload();
    const originalSlug = $("#original-slug").value;
    const original = events.find((item) => item.slug === originalSlug);
    const riskyChange = payload.is_public && !original?.is_public
      ? "Kegiatan akan ditampilkan di website. Lanjutkan?"
      : ["cancelled", "completed"].includes(payload.status) && payload.status !== original?.status
        ? `Status kegiatan akan diubah menjadi ${statusLabels[payload.status]}. Lanjutkan?`
        : "";
    if (riskyChange && !window.confirm(riskyChange)) return;

    const button = $("#save-button");
    button.disabled = true;
    button.textContent = "Menyimpan…";
    setFeedback($("#form-feedback"));
    try {
      await adminRequest(originalSlug ? "PATCH" : "POST", originalSlug, payload);
      invalidateEventsCache();
      await loadEvents();
      showEvents();
      setFeedback($("#events-feedback"), "Kegiatan berhasil disimpan.", "success");
    } catch (error) {
      setFeedback($("#form-feedback"), error.message, "error");
    } finally {
      button.disabled = false;
      button.textContent = "Simpan Kegiatan";
    }
  });

  storyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (storyImageUploading) {
      setFeedback($("#story-form-feedback"), "Tunggu sampai upload foto selesai.", "error");
      return;
    }
    const payload = storyFormPayload();
    const originalSlug = $("#original-story-slug").value;
    const original = stories.find((item) => item.slug === originalSlug);
    if (payload.status === "published" && original?.status !== "published"
      && !window.confirm("Kisah akan diterbitkan dan tampil melalui API publik. Lanjutkan?")) return;

    const button = $("#save-story-button");
    button.disabled = true;
    button.textContent = "Menyimpan…";
    setFeedback($("#story-form-feedback"));
    try {
      await adminStoriesRequest(originalSlug ? "PATCH" : "POST", originalSlug, payload);
      invalidateStoriesCache();
      await showStories();
      setFeedback($("#stories-feedback"), "Kisah berhasil disimpan.", "success");
    } catch (error) {
      setFeedback($("#story-form-feedback"), error.message, "error");
    } finally {
      button.disabled = false;
      button.textContent = "Simpan Kisah";
    }
  });

  eventsList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-edit-slug]");
    if (!button) return;
    const selected = events.find((item) => item.slug === button.dataset.editSlug);
    if (selected) showForm(selected);
  });

  storiesList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-edit-story]");
    if (!button) return;
    const selected = stories.find((item) => item.slug === button.dataset.editStory);
    if (selected) showStoryForm(selected);
  });

  eventsList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-event-archive]");
    if (!button) return;
    const slug = button.dataset.eventArchive;
    const selected = events.find((item) => item.slug === slug);
    if (!selected) return;
    const archived = Boolean(selected.archived_at);
    const message = archived
      ? "Pulihkan kegiatan ini agar dapat tampil kembali sesuai pengaturan publikasinya?"
      : "Kegiatan ini akan disembunyikan dari website, tetapi data pendaftar tetap tersimpan.";
    if (!window.confirm(message)) return;
    button.disabled = true;
    try {
      await adminRequest("PATCH", slug, undefined, archived ? "restore" : "archive");
      invalidateEventsCache();
      await loadEvents();
      setFeedback($("#events-feedback"), `Kegiatan berhasil ${archived ? "dipulihkan" : "diarsipkan"}.`, "success");
    } catch (error) {
      setFeedback($("#events-feedback"), error.message, "error");
      button.disabled = false;
    }
  });

  eventsList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-event-delete]");
    if (!button) return;
    const selected = events.find((item) => item.slug === button.dataset.eventDelete);
    if (!selected?.archived_at) return;
    const confirmation = window.prompt(`Ketik judul kegiatan untuk menghapus permanen:\n${selected.title}`);
    if (confirmation !== selected.title) {
      if (confirmation !== null) setFeedback($("#events-feedback"), "Judul kegiatan belum cocok. Kegiatan tidak dihapus.", "error");
      return;
    }
    button.disabled = true;
    try {
      await adminRequest("DELETE", selected.slug);
      invalidateEventsCache();
      await loadEvents();
      setFeedback($("#events-feedback"), "Kegiatan berhasil dihapus permanen.", "success");
    } catch (error) {
      setFeedback($("#events-feedback"), error.message, "error");
      button.disabled = false;
    }
  });

  storiesList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-story-archive]");
    if (!button) return;
    const slug = button.dataset.storyArchive;
    const selected = stories.find((item) => item.slug === slug);
    if (!selected) return;
    const archived = Boolean(selected.archived_at);
    const message = archived
      ? "Pulihkan kisah ini agar dapat tampil kembali sesuai statusnya?"
      : "Kisah ini akan disembunyikan dari website dan dapat dipulihkan kembali.";
    if (!window.confirm(message)) return;
    button.disabled = true;
    try {
      await adminStoriesRequest("PATCH", slug, undefined, archived ? "restore" : "archive");
      invalidateStoriesCache();
      await loadStories();
      setFeedback($("#stories-feedback"), `Kisah berhasil ${archived ? "dipulihkan" : "diarsipkan"}.`, "success");
    } catch (error) {
      setFeedback($("#stories-feedback"), error.message, "error");
      button.disabled = false;
    }
  });

  storiesList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-story-delete]");
    if (!button) return;
    const selected = stories.find((item) => item.slug === button.dataset.storyDelete);
    if (!selected?.archived_at) return;
    const confirmation = window.prompt(`Ketik judul kisah untuk menghapus permanen:\n${selected.title}`);
    if (confirmation !== selected.title) {
      if (confirmation !== null) setFeedback($("#stories-feedback"), "Judul kisah belum cocok. Kisah tidak dihapus.", "error");
      return;
    }
    button.disabled = true;
    try {
      await adminStoriesRequest("DELETE", selected.slug);
      invalidateStoriesCache();
      await loadStories();
      setFeedback($("#stories-feedback"), "Kisah berhasil dihapus permanen.", "success");
    } catch (error) {
      setFeedback($("#stories-feedback"), error.message, "error");
      button.disabled = false;
    }
  });

  eventArchiveFilter.addEventListener("change", renderEvents);
  storyArchiveFilter.addEventListener("change", renderStories);

  const logout = async () => {
    const session = readSession();
    try { if (session?.access_token) await authRequest("logout", null, session.access_token); }
    catch { /* Local session is still cleared when the server session has expired. */ }
    clearSession();
    events = [];
    registrations = [];
    admins = [];
    stories = [];
    tabCache.events.loadedAt = 0;
    tabCache.events.request = null;
    tabCache.stories.loadedAt = 0;
    tabCache.stories.request = null;
    tabCache.admins.loadedAt = 0;
    tabCache.admins.request = null;
    tabCache.registrations.clear();
    currentRole = "";
    loginForm.reset();
    passwordSetupForm.reset();
    showLogin();
  };

  $("#add-event-button").addEventListener("click", () => showForm());
  $("#back-button").addEventListener("click", showEvents);
  $("#cancel-button").addEventListener("click", showEvents);
  $("#add-story-button").addEventListener("click", () => showStoryForm());
  $("#story-back-button").addEventListener("click", showStories);
  $("#story-cancel-button").addEventListener("click", showStories);
  $("#logout-button").addEventListener("click", logout);
  $("#mobile-logout-button").addEventListener("click", logout);

  (async () => {
    if (readAuthError() || readRecoverySession() || readInviteSession()) return;
    const token = await validAccessToken();
    if (!token) return showLogin();
    showAdmin();
    await loadEvents();
    prefetchAdminTabs();
  })();
})();
