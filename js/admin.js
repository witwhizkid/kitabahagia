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
  const adminCertificateIssueUrl = `${CONFIG.supabaseUrl}/functions/v1/admin-certificate-issue`;

  const $ = (selector) => document.querySelector(selector);
  const loginView = $("#login-view");
  const loginPanel = $("#login-view .login-panel:not(#password-setup-panel)");
  const passwordSetupPanel = $("#password-setup-panel");
  const adminView = $("#admin-view");
  const eventsView = $("#events-view");
  const homeView = $("#home-view");
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
  // Uploads in flight (poster + documentation photos); Save stays disabled until all finish.
  let imageUploading = 0;
  // Documentation highlight photos of the event being edited: [{ url, alt }], max 5.
  let docPhotos = [];
  const DOC_PHOTO_LIMIT = 5;
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
    home.loadedAt = 0;
    home.checksAt = 0;
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
  // Manual QRIS (alur C): confirmed on upload, so the proof still waits for an admin check.
  const proofUnchecked = (registration) => registration.registration_status === "confirmed"
    && Boolean(registration.payment_proof_submitted_at) && !registration.payment_reviewed_at;

  const referralSourceLabels = {
    instagram: "Instagram",
    tiktok: "TikTok",
    whatsapp: "Grup/pesan WhatsApp",
    teman: "Informasi teman",
    kampus: "Kampus, sekolah, atau komunitas",
    website: "Website Kita Bahagia",
    lainnya: "Lainnya",
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

  // Success messages pop up as a toast; errors and progress stay next to the form they belong to.
  // Styled replacement for window.confirm/prompt. Resolves true only on the confirm button;
  // requireText keeps it disabled until that exact text is typed (permanent deletes).
  const confirmDialog = $("#confirm-dialog");
  const confirmAction = (message, { title = "Yakin?", confirmLabel = "Lanjutkan", danger = false, requireText = "" } = {}) => new Promise((resolve) => {
    const ok = $("#confirm-ok");
    const input = $("#confirm-input");
    $("#confirm-title").textContent = title;
    $("#confirm-message").textContent = message;
    ok.textContent = confirmLabel;
    ok.classList.toggle("is-danger", danger);
    $("#confirm-input-label").hidden = !requireText;
    $("#confirm-input-hint").textContent = requireText ? `Ketik "${requireText}" untuk melanjutkan.` : "";
    input.value = "";
    const sync = () => { ok.disabled = Boolean(requireText) && input.value.trim() !== requireText.trim(); };
    input.oninput = sync;
    sync();
    confirmDialog.returnValue = "";
    confirmDialog.addEventListener("close", () => resolve(confirmDialog.returnValue === "ok"), { once: true });
    confirmDialog.showModal();
    (requireText ? input : ok).focus();
  });
  confirmDialog.addEventListener("click", (event) => { if (event.target === confirmDialog) confirmDialog.close("cancel"); });
  $("#confirm-input").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!$("#confirm-ok").disabled) confirmDialog.close("ok");
  });

  const showToast = (message) => {
    const region = document.getElementById("toast-region");
    if (!region) return;
    // A modal dialog sits in the top layer, so the toast has to live inside it to be seen.
    const host = document.querySelector("dialog[open]") || document.body;
    if (region.parentElement !== host) host.append(region);
    // The same message can be reported to two feedback spots (list + dialog); show it once.
    if ([...region.children].some((toast) => toast.textContent === message && !toast.classList.contains("is-leaving"))) return;
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    region.append(toast);
    window.setTimeout(() => toast.classList.add("is-leaving"), 3200);
    window.setTimeout(() => toast.remove(), 3700);
  };
  // Success inside the dashboard becomes a toast; the login screen keeps its message in place.
  const setFeedback = (element, message = "", type = "") => {
    if (type === "success" && message && !element.closest(".login-shell")) {
      showToast(message);
      message = "";
      type = "";
    }
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

  // attendance: "present" | "absent" | "clear" (back to not marked).
  const attendanceRequest = (registration_codes, attendance) => authorizedRequest(adminRegistrationsUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ registration_codes, attendance }),
  });
  // Manual QRIS: payment: "valid" | "cancelled" for one registrant whose proof is unchecked.
  const manualPaymentRequest = (registrationCode, payment) => authorizedRequest(adminRegistrationsUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ registration_codes: [registrationCode], payment }),
  });
  const attendanceState = (registration) => registration.attended_at ? "present" : registration.absent_at ? "absent" : "";

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
    const counts = seatCounts();
    eventsList.innerHTML = visibleEvents.map((event) => `
      <article class="event-row">
        ${posterMarkup(event, "event-thumb")}
        <div>
          <h2>${escapeHtml(event.title)}</h2>
          ${capacityMarkup(event, counts[event.slug])}
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
    applyCapacityBars(eventsList);
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
            ${proofUnchecked(registration) ? '<span class="proof-check-token">Bukti belum dicek</span>' : ""}
            ${registrationStatus !== "confirmed" ? "" : registration.attended_at ? '<span class="attendance-token">Hadir</span>'
              : registration.absent_at ? '<span class="attendance-token is-absent">Tidak hadir</span>' : ""}
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
    const absentRows = confirmedRows.filter((item) => item.absent_at).length;
    const unmarkedRows = confirmedRows.length - attendedRows - absentRows;
    const attendanceSummary = $("#attendance-summary");
    attendanceSummary.hidden = !isBulk;
    // Counted from the rows shown, so say so when a search or status filter narrows them.
    const narrowed = ["#registration-search", "#registration-status-filter", "#payment-status-filter"]
      .some((selector) => $(selector).value.trim() !== "");
    attendanceSummary.textContent = ` · Hadir ${attendedRows} · Tidak hadir ${absentRows}${unmarkedRows ? ` · Belum ditandai ${unmarkedRows}` : ""} dari ${confirmedRows.length} terkonfirmasi${narrowed ? " (sesuai filter)" : ""}`;
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
  // Manual QRIS: the uploaded payment screenshot (signed URL); while unchecked, "Valid" records
  // the check and "Batalkan" cancels the registration (seat released) and offers a WA draft.
  const loadPaymentProof = async (registration) => {
    const field = applicantDialogContent.querySelector(".applicant-payment-proof-field");
    if (!field) return;
    try {
      const result = await applicantProofRequest(registration.registration_code);
      if (currentDialogApplicant()?.registration_code !== registration.registration_code) return;
      const href = result.payment_proof?.signed_url ? new URL(result.payment_proof.signed_url) : null;
      if (!href || href.origin !== new URL(CONFIG.supabaseUrl).origin) {
        field.querySelector("p").textContent = "Bukti tidak dapat dimuat.";
        return;
      }
      const image = document.createElement("img");
      image.className = "applicant-proof-preview";
      image.src = href.href;
      image.alt = "Screenshot bukti pembayaran pendaftar";
      image.referrerPolicy = "no-referrer";
      field.querySelector("p").replaceChildren(externalLink(href.href, "Buka ukuran penuh"));
      field.append(image);
      if (registration.payment_reviewed_at) {
        const checked = document.createElement("p");
        checked.className = "applicant-proof-checked";
        const phone = registration.registration_status === "cancelled" ? normalizeWhatsApp(registration.phone) : "";
        checked.textContent = registration.registration_status === "cancelled"
          ? `Dibatalkan ${formatDateTime(registration.payment_reviewed_at)}${phone ? " · " : ""}`
          : `Sudah dicek ${formatDateTime(registration.payment_reviewed_at)}`;
        if (phone) {
          const message = `Halo ${registration.name}, kami belum menemukan pembayaran untuk pendaftaran ${registration.events?.title || "kegiatan Kita Bahagia"} (kode ${registration.registration_code}), jadi pendaftaranmu kami batalkan. Kalau kamu merasa sudah membayar, balas pesan ini dengan bukti mutasinya ya.`;
          checked.append(externalLink(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "Kabari lewat WhatsApp"));
        }
        field.append(checked);
      }
      if (!proofUnchecked(registration)) return;
      const actions = document.createElement("div");
      actions.className = "applicant-payment-actions";
      const decide = async (payment) => {
        if (payment === "cancelled" && !(await confirmAction(
          "Pendaftaran dibatalkan dan kuotanya kembali dibuka. Setelah ini kabari pendaftar lewat WhatsApp, dan keluarkan dari grup kalau sudah masuk.",
          { title: "Batalkan pendaftaran ini?", confirmLabel: "Batalkan", danger: true },
        ))) return;
        actions.querySelectorAll("button").forEach((button) => { button.disabled = true; });
        try {
          await manualPaymentRequest(registration.registration_code, payment);
          await refreshRegistrations();
          showToast(payment === "valid" ? "Bukti pembayaran valid." : "Pendaftaran dibatalkan. Kuota kembali dibuka.");
          // Under the "Bukti belum dicek" filter the row leaves the list, so the panel closes too.
          if (registrations.some((item) => item.registration_code === registration.registration_code)) {
            if (applicantDialog.open) showApplicant(registration.registration_code);
          } else if (applicantDialog.open) applicantDialog.close();
        } catch (error) {
          setFeedback($("#applicant-dialog-feedback"), error.message || "Keputusan pembayaran belum dapat disimpan.", "error");
          actions.querySelectorAll("button").forEach((button) => { button.disabled = false; });
        }
      };
      const paid = document.createElement("button");
      paid.type = "button";
      paid.className = "button button-primary";
      paid.textContent = "Valid";
      paid.addEventListener("click", () => decide("valid"));
      const reject = document.createElement("button");
      reject.type = "button";
      reject.className = "button button-secondary";
      reject.textContent = "Batalkan";
      reject.addEventListener("click", () => decide("cancelled"));
      actions.append(paid, reject);
      field.append(actions);
    } catch (error) {
      if (currentDialogApplicant()?.registration_code === registration.registration_code) {
        setFeedback($("#applicant-dialog-feedback"), error.message || "Bukti pembayaran belum dapat dibuka.", "error");
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
    appendApplicantField("Usia", applicant.age);
    appendApplicantField("Instagram/TikTok", applicant.social_account);
    appendApplicantField("Tahu dari", referralSourceLabels[applicant.referral_source] || applicant.referral_source);
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
    if (applicant.manual_amount) {
      appendApplicantField("Nominal transfer (QRIS manual)", `Rp${Number(applicant.manual_amount).toLocaleString("id-ID")}`);
      if (applicant.payment_proof_submitted_at) {
        appendApplicantField("Diunggah", formatDateTime(applicant.payment_proof_submitted_at));
        appendApplicantField("Bukti pembayaran", "Memuat bukti…", { wide: true });
        applicantGroup.lastElementChild.classList.add("applicant-payment-proof-field");
        void loadPaymentProof(applicant);
      } else if (status === "pending_payment") {
        appendApplicantField("Bukti pembayaran", "Belum diunggah");
      }
    }
    if (status === "confirmed") {
      appendApplicantField("Kehadiran", applicant.attended_at ? `Hadir · ditandai ${formatDateTime(applicant.attended_at)}`
        : applicant.absent_at ? `Tidak hadir · ditandai ${formatDateTime(applicant.absent_at)}` : "Belum ditandai");
    }
    const outcomes = isSelectionEvent && ["confirmed", "waitlisted", "rejected"].includes(status);
    applicantDialog.querySelector(".applicant-selection-actions").hidden = !isSelectionEvent;
    syncSelectionDecisionControls();
    const waButton = applicantDialog.querySelector("[data-applicant-whatsapp]");
    waButton.hidden = !outcomes;
    // Same rules as the bulk "Tandai hadir": confirmed registrants, from the event day (WIB).
    // Clicking the button of the current state clears it (back to not marked).
    const canMark = status === "confirmed";
    const eventStarted = Boolean(event.event_date) && event.event_date <= todayInJakarta();
    const currentAttendance = attendanceState(applicant);
    applicantDialog.querySelectorAll("[data-applicant-attendance]").forEach((attendanceButton) => {
      const state = attendanceButton.dataset.applicantAttendance;
      const active = currentAttendance === state;
      attendanceButton.hidden = !canMark;
      attendanceButton.textContent = state === "present"
        ? (active ? "Batal hadir" : "Tandai hadir") : (active ? "Batal tidak hadir" : "Tidak hadir");
      attendanceButton.className = `button ${state === "present" && !currentAttendance ? "button-primary" : "button-secondary"}`;
      attendanceButton.disabled = !eventStarted;
      attendanceButton.title = eventStarted ? "" : "Kehadiran baru bisa ditandai mulai hari kegiatan.";
    });
    applicantDialog.querySelector(".applicant-dialog-footer").hidden = !outcomes && !canMark;
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
    home.loadedAt = 0;
    home.checksAt = 0;
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

  const attendanceCopy = {
    present: { pending: "Menandai hadir…", done: "ditandai hadir", same: "sudah hadir" },
    absent: { pending: "Menandai tidak hadir…", done: "ditandai tidak hadir", same: "sudah tidak hadir" },
    clear: { pending: "Mengosongkan tanda kehadiran…", done: "dikosongkan tanda kehadirannya", same: "belum ditandai" },
  };
  const markAttendance = async (codes, state) => {
    const feedback = $("#registrations-feedback");
    if (!codes.length) return setFeedback(feedback, "Pilih setidaknya satu pendaftar.", "error");
    const copy = attendanceCopy[state];
    setFeedback(feedback, copy.pending);
    selectionDecisionPending = true;
    syncSelectionDecisionControls();
    try {
      const { attendance = {} } = await attendanceRequest(codes, state);
      const changed = Number(attendance.changed) || 0;
      const skipped = Number(attendance.skipped) || 0;
      const unchanged = Number(attendance.unchanged) || 0;
      const parts = [`${changed} pendaftar ${copy.done}`];
      if (unchanged) parts.push(`${unchanged} ${copy.same} sebelumnya`);
      if (skipped) parts.push(`${skipped} dilewati karena belum terkonfirmasi`);
      $("#selection-select-all").checked = false;
      try {
        await refreshRegistrations();
      } catch (refreshError) {
        setFeedback(feedback, `Kehadiran tersimpan, tapi daftar belum bisa diperbarui: ${refreshError.message}`, "error");
        return;
      }
      setFeedback(feedback, `${parts.join(" · ")}.`, skipped ? "warning" : "success");
    } catch (error) {
      setFeedback(feedback, error.message, "error");
    } finally {
      selectionDecisionPending = false;
      syncSelectionDecisionControls();
    }
  };

  // Excel export in KB colours (js/admin-xlsx.js): title band, cream header with filter, zebra rows,
  // coloured status/attendance, WhatsApp kept as text so the leading 0 survives.
  const statusTones = { confirmed: "green", applied: "gold", pending_payment: "gold", waitlisted: "cream" };
  const exportRegistrations = () => {
    const event = selectedRegistrationEvent();
    const columns = [
      { label: "Kode", width: 23 }, { label: "Nama", width: 26 },
      ...(event ? [] : [{ label: "Kegiatan", width: 30 }]),
      { label: "Email", width: 34 }, { label: "WhatsApp", width: 18 }, { label: "Domisili", width: 16 },
      { label: "Instansi", width: 24 }, { label: "Usia", width: 9, kind: "number" }, { label: "Instagram/TikTok", width: 20 },
      { label: "Tahu dari", width: 16 }, { label: "Definisi bahagia", width: 42, kind: "wrap" },
      { label: "Jawaban seleksi", width: 42, kind: "wrap" }, { label: "Link portofolio", width: 26 },
      { label: "Status", width: 18 }, { label: "Hadir", width: 9 }, { label: "Terdaftar", width: 19 },
    ];
    const rows = registrations.map((applicant) => {
      const status = applicant.registration_status;
      const statusLabel = selectionEnabled() && status === "confirmed"
        ? "Diterima" : registrationStatusLabels[status] || status;
      const attended = status !== "confirmed" ? "" : applicant.attended_at ? "Ya" : applicant.absent_at ? "Tidak" : "";
      return [
        applicant.registration_code, applicant.name,
        ...(event ? [] : [applicant.events?.title || ""]),
        applicant.email, applicant.phone, applicant.domicile, applicant.institution, applicant.age, applicant.social_account,
        referralSourceLabels[applicant.referral_source] || applicant.referral_source, applicant.reason,
        applicant.selection_answer, applicant.portfolio_url,
        { value: statusLabel, tone: statusTones[status] || "grey" },
        { value: attended, tone: attended === "Ya" ? "green" : "grey" },
        applicant.created_at ? new Date(applicant.created_at) : "",
      ];
    });
    const exportedAt = new Intl.DateTimeFormat("id-ID", {
      day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta",
    }).format(new Date());
    const blob = window.KBXlsx.build({
      sheetName: "Pendaftar",
      title: `Kita Bahagia · ${event?.title || "Semua kegiatan"}`,
      subtitle: `${rows.length} pendaftar · diekspor ${exportedAt} WIB`,
      columns,
      rows,
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pendaftar-${event?.slug || "kegiatan"}.xlsx`;
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
    void markAttendance(codes, button.dataset.attendanceBulk);
  }));
  $("#registrations-export").addEventListener("click", exportRegistrations);
  applicantDialog.querySelector(".applicant-dialog-close").addEventListener("click", () => applicantDialog.close());
  applicantDialog.addEventListener("click", (event) => { if (event.target === applicantDialog) applicantDialog.close(); });
  applicantDialog.querySelectorAll("[data-applicant-attendance]").forEach((button) => button.addEventListener("click", async () => {
    const applicant = currentDialogApplicant();
    if (!applicant) return;
    const code = applicant.registration_code;
    const state = attendanceState(applicant) === button.dataset.applicantAttendance ? "clear" : button.dataset.applicantAttendance;
    const feedback = $("#applicant-dialog-feedback");
    const buttons = applicantDialog.querySelectorAll("[data-applicant-attendance]");
    buttons.forEach((item) => { item.disabled = true; });
    setFeedback(feedback, attendanceCopy[state].pending);
    try {
      await attendanceRequest([code], state);
    } catch (error) {
      buttons.forEach((item) => { item.disabled = false; });
      setFeedback(feedback, error.message, "error");
      return;
    }
    // Show the result right away; the list refresh below brings the server's timestamp.
    const now = new Date().toISOString();
    applicant.attended_at = state === "present" ? now : null;
    applicant.absent_at = state === "absent" ? now : null;
    const done = { present: "Ditandai hadir.", absent: "Ditandai tidak hadir.", clear: "Tanda kehadiran dikosongkan." }[state];
    if (applicantDialog.open && currentDialogApplicant()?.registration_code === code) renderApplicantDialog();
    setFeedback(feedback, done, "success");
    try {
      await refreshRegistrations();
    } catch {
      return;
    }
    if (applicantDialog.open && currentDialogApplicant()?.registration_code === code) {
      showApplicant(code);
      setFeedback($("#applicant-dialog-feedback"), done, "success");
    }
  }));
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
            ${!isSelf && (!admin.is_active || admin.signed_in === false) ? `<button class="button button-secondary delete-button" type="button" data-delete-admin>Hapus</button>` : ""}
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
    $("#event-program-key").value = event?.program_key || "";
    $("#event-documentation-url").value = event?.documentation_url || "";
    docPhotos = Array.isArray(event?.documentation_photos) ? event.documentation_photos.map((photo) => ({ url: photo.url, alt: photo.alt || "" })) : [];
    renderDocPhotos();
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
    homeView.hidden = true;
    registrationsView.hidden = true;
    adminsView.hidden = true;
    certificatesView.hidden = true;
    storiesView.hidden = true;
    storyFormView.hidden = true;
    formView.hidden = false;
    window.scrollTo({ top: 0, behavior: "instant" });
    refreshEventForm();
    markDirty(eventForm, false);
    $("#event-title").focus();
  };

  // Form polish: choice pills, live hints, section progress, unsaved marker, live preview.
  const choicePills = (select) => {
    const group = document.createElement("div");
    group.className = "choice-pills";
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", select.closest("label")?.firstChild?.textContent.trim() || select.name);
    [...select.options].forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice-pill";
      button.dataset.value = option.value;
      button.textContent = option.textContent;
      button.setAttribute("role", "radio");
      button.addEventListener("click", () => {
        if (select.value === option.value) return;
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      group.append(button);
    });
    // The select stays the source of truth (form data + existing change handlers).
    select.classList.add("visually-hidden");
    select.tabIndex = -1;
    select.after(group);
    const sync = () => group.querySelectorAll(".choice-pill").forEach((button) => {
      const active = button.dataset.value === select.value;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-checked", String(active));
    });
    select.addEventListener("change", sync);
    return sync;
  };
  const pillSyncs = [choicePills($("#event-registration-mode")), choicePills($("#event-status"))];

  // KB dropdown for every other <select>: the native select stays the source of truth
  // (form values, change handlers, programmatic .value), only its UI is replaced.
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  const nativeIndex = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "selectedIndex");
  let openDropdown = null;
  const closeDropdown = (focusButton = false) => {
    if (!openDropdown) return;
    const { list, button } = openDropdown;
    list.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (focusButton) button.focus();
    openDropdown = null;
  };
  const enhanceSelect = (select) => {
    if (select.dataset.kbSelect || select.classList.contains("visually-hidden") || select.multiple) return;
    select.dataset.kbSelect = "1";
    const wrap = document.createElement("div");
    wrap.className = "kb-select";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "kb-select-button";
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");
    const label = select.getAttribute("aria-label") || select.closest("label")?.firstChild?.textContent.trim();
    if (label) button.setAttribute("aria-label", label);
    const text = document.createElement("span");
    text.className = "kb-select-text";
    button.append(text);
    const list = document.createElement("ul");
    list.className = "kb-select-list";
    list.setAttribute("role", "listbox");
    list.hidden = true;
    wrap.append(button, list);
    select.after(wrap);
    select.classList.add("kb-select-native");
    select.tabIndex = -1;
    const sync = () => {
      const option = select.options[nativeIndex.get.call(select)];
      text.textContent = option?.textContent || "";
      button.disabled = select.disabled;
    };
    const build = () => {
      list.replaceChildren(...[...select.options].map((option, index) => {
        const item = document.createElement("li");
        item.setAttribute("role", "option");
        item.dataset.index = String(index);
        item.textContent = option.textContent;
        item.setAttribute("aria-selected", String(option.selected));
        if (option.disabled) item.setAttribute("aria-disabled", "true");
        return item;
      }));
    };
    const pick = (index) => {
      const option = select.options[index];
      if (!option || option.disabled) return;
      if (nativeIndex.get.call(select) !== index) {
        nativeIndex.set.call(select, index);
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      sync();
      closeDropdown(true);
    };
    const highlight = (index) => {
      const items = [...list.children];
      items.forEach((item) => item.classList.toggle("is-active", Number(item.dataset.index) === index));
      items.find((item) => Number(item.dataset.index) === index)?.scrollIntoView({ block: "nearest" });
    };
    const activeIndex = () => Number(list.querySelector(".is-active")?.dataset.index ?? nativeIndex.get.call(select));
    const step = (delta) => {
      const options = [...select.options];
      let index = activeIndex();
      do index += delta; while (options[index]?.disabled);
      if (options[index]) highlight(index);
    };
    const open = () => {
      if (select.disabled) return;
      closeDropdown();
      build();
      // Open upwards when there is not enough room below.
      const rect = button.getBoundingClientRect();
      wrap.classList.toggle("is-up", window.innerHeight - rect.bottom < 260 && rect.top > 260);
      list.hidden = false;
      button.setAttribute("aria-expanded", "true");
      openDropdown = { list, button };
      highlight(nativeIndex.get.call(select));
    };
    button.addEventListener("click", () => (list.hidden ? open() : closeDropdown()));
    button.addEventListener("keydown", (event) => {
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        if (list.hidden) open();
        else step(event.key === "ArrowDown" ? 1 : -1);
      } else if (["Enter", " "].includes(event.key) && !list.hidden) {
        event.preventDefault();
        pick(activeIndex());
      } else if (event.key === "Escape" && !list.hidden) {
        event.preventDefault();
        closeDropdown(true);
      } else if (event.key === "Tab") {
        closeDropdown();
      }
    });
    list.addEventListener("mousedown", (event) => event.preventDefault());
    list.addEventListener("click", (event) => {
      const item = event.target.closest("[role=option]");
      if (item) pick(Number(item.dataset.index));
    });
    // Keep the button in step with code that sets .value/.selectedIndex directly, rebuilt
    // options, disabled toggles, and form resets.
    Object.defineProperty(select, "value", { configurable: true, get() { return nativeValue.get.call(this); }, set(value) { nativeValue.set.call(this, value); sync(); } });
    Object.defineProperty(select, "selectedIndex", { configurable: true, get() { return nativeIndex.get.call(this); }, set(value) { nativeIndex.set.call(this, value); sync(); } });
    select.addEventListener("change", sync);
    select.addEventListener("focus", () => button.focus());
    select.form?.addEventListener("reset", () => setTimeout(sync));
    new MutationObserver(sync).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
    sync();
  };
  document.addEventListener("click", (event) => {
    if (openDropdown && !event.target.closest(".kb-select")) closeDropdown();
  });
  document.querySelectorAll("select").forEach(enhanceSelect);
  // Selects rendered later (e.g. the role picker in Kelola Admin) get the same dropdown.
  new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach((node) => {
    if (node.nodeType !== 1) return;
    if (node.matches("select")) enhanceSelect(node);
    node.querySelectorAll?.("select").forEach(enhanceSelect);
  }))).observe(document.body, { childList: true, subtree: true });

  const syncFormHints = () => {
    const length = $("#event-title").value.trim().length;
    const count = $("#event-title-count");
    count.textContent = length > 80 ? `${length} karakter · lebih dari 80 bisa terpotong di kartu HP` : `${length}/80 karakter`;
    count.classList.toggle("is-warning", length > 80);
    const price = Number($("#event-price").value);
    $("#event-price-hint").textContent = price > 0 ? `Rp${price.toLocaleString("id-ID")}` : "Gratis";
  };
  const syncJumpState = () => document.querySelectorAll(".form-jump a").forEach((link) => {
    const section = document.getElementById(link.hash.slice(1))?.closest(".form-section");
    if (!section) return;
    const fields = [...section.querySelectorAll("input:not([type=hidden]):not([type=file]), select, textarea, input[type=hidden][name]")]
      .filter((field) => !field.closest("[hidden]"));
    const valid = fields.every((field) => field.checkValidity());
    const filled = fields.some((field) => (field.type === "checkbox" ? field.checked : field.value.trim()));
    link.classList.toggle("is-done", valid && filled);
  });
  const renderEventPreview = () => {
    const title = $("#event-title").value.trim();
    const poster = $("#preview-poster");
    const image = $("#event-image-preview-img");
    if (!$("#event-image-preview").hidden && image.getAttribute("src")) {
      const img = document.createElement("img");
      img.src = image.src;
      img.alt = "";
      poster.replaceChildren(img);
    } else {
      poster.textContent = (title || "?").charAt(0).toUpperCase();
    }
    const date = $("#event-date").value;
    const time = $("#event-start-time").value;
    $("#preview-when").textContent = date
      ? `${new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" }).format(new Date(`${date}T12:00:00+07:00`))}${time ? ` · ${time.replace(":", ".")} WIB` : ""}`
      : "Tanggal belum diisi";
    $("#preview-title").textContent = title || "Judul kegiatan";
    $("#preview-where").textContent = $("#event-location").value.trim() || "Lokasi belum diisi";
    const price = Number($("#event-price").value);
    const selection = $("#event-registration-mode").value === "selection";
    $("#preview-price").textContent = `${price > 0 ? `Rp${price.toLocaleString("id-ID")}` : "Gratis"}${selection ? " · Seleksi" : ""}`;
    $("#preview-state").textContent = $("#event-public").checked
      ? `Tampil di website · ${statusLabels[$("#event-status").value] || ""}`
      : "Belum tampil di website";
  };
  const refreshEventForm = () => {
    pillSyncs.forEach((sync) => sync());
    syncFormHints();
    syncJumpState();
    renderEventPreview();
  };
  eventForm.addEventListener("input", refreshEventForm);
  eventForm.addEventListener("change", refreshEventForm);
  // Uploads and removals change the photo preview without an input event.
  new MutationObserver(renderEventPreview).observe($("#event-image-preview"), { attributes: true, subtree: true, attributeFilter: ["hidden", "src"] });

  // "Belum disimpan" marker and a confirm before leaving a changed form.
  const dirtyForms = new Set();
  const markDirty = (form, dirty) => {
    if (dirty) dirtyForms.add(form);
    else dirtyForms.delete(form);
    form.querySelector("[data-form-dirty]").hidden = !dirty;
  };
  [eventForm, storyForm].forEach((form) => {
    form.addEventListener("input", () => markDirty(form, true));
    form.addEventListener("change", () => markDirty(form, true));
  });
  const confirmLeaveForm = async () => {
    const open = [...dirtyForms].filter((form) => !form.closest("[hidden]"));
    if (open.length && !(await confirmAction("Perubahan yang belum disimpan akan hilang.", { title: "Tinggalkan formulir?", confirmLabel: "Tinggalkan", danger: true }))) return false;
    open.forEach((form) => markDirty(form, false));
    return true;
  };
  window.addEventListener("beforeunload", (event) => {
    // Issuing certificates paces its emails, so closing the tab mid-run would leave some unsent.
    if ([...dirtyForms].some((form) => !form.closest("[hidden]")) || issuance.running) event.preventDefault();
  });

  // Beranda: what needs attention today, computed from events + active registrations.
  const home = { registrations: [], loadedAt: 0, request: null, checks: new Map(), checksAt: 0 };
  const loadHomeRegistrations = async (force = false) => {
    if (!force && home.loadedAt && Date.now() - home.loadedAt < adminCacheTtl) return home.registrations;
    if (home.request) return home.request;
    home.request = registrationRequest({ lifecycle: "active" })
      .then((data) => {
        home.registrations = Array.isArray(data.registrations) ? data.registrations : [];
        home.loadedAt = Date.now();
        return home.registrations;
      })
      .finally(() => { home.request = null; });
    return home.request;
  };
  // Seats per event: confirmed, plus unpaid holds still inside their payment window.
  function seatCounts() {
    const counts = {};
    home.registrations.forEach((registration) => {
      const slug = registration.events?.slug;
      if (!slug) return;
      counts[slug] ||= { confirmed: 0, held: 0, applied: 0 };
      if (registration.registration_status === "confirmed") counts[slug].confirmed += 1;
      else if (registration.registration_status === "pending_payment" && !registration.payment_expired) counts[slug].held += 1;
      else if (registration.registration_status === "applied") counts[slug].applied += 1;
    });
    return counts;
  }
  // Relative paths in image_url are site paths; the admin page lives one folder down.
  const posterSrc = (url) => (!url || /^(https?:)?\/\//.test(url) || url.startsWith("/") ? url : `../${url}`);
  function posterMarkup(event, className) {
    const src = posterSrc(event.image_url);
    return `<span class="${className}" aria-hidden="true">${src
      ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
      : `<span>${escapeHtml((event.title || "?").trim().charAt(0).toUpperCase())}</span>`}</span>`;
  }
  function capacityMarkup(event, count) {
    // Counts come from active registrations only, so finished events show none.
    if (!home.loadedAt || event.archived_at || !event.event_date || daysFromToday(eventLastDay(event)) < 0) return "";
    const current = count || { confirmed: 0, held: 0, applied: 0 };
    if (event.registration_mode === "selection") {
      return `<p class="capacity-line">${current.applied} menunggu seleksi · ${current.confirmed}/${escapeHtml(String(event.capacity || "?"))} diterima</p>`;
    }
    if (!event.capacity) return `<p class="capacity-line">${current.confirmed} terkonfirmasi</p>`;
    const filled = current.confirmed + current.held;
    const percent = Math.min(100, Math.round((filled / event.capacity) * 100));
    const tone = percent >= 100 ? " is-full" : percent >= 80 ? " is-hot" : "";
    return `<div class="capacity${tone}">
      <span class="capacity-bar" data-fill="${percent}"><span></span></span>
      <span class="capacity-text"><strong>${filled}/${escapeHtml(String(event.capacity))}</strong> kursi${current.held ? ` · ${current.held} menunggu bayar` : ""}</span>
    </div>`;
  }
  // Widths are set through CSSOM (allowed by the CSP), not a style attribute.
  function applyCapacityBars(root) {
    root.querySelectorAll(".capacity-bar[data-fill]").forEach((bar) => bar.style.setProperty("--fill", `${bar.dataset.fill}%`));
  }

  const jakartaDay = (value) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(value));
  const daysFromToday = (date) => Math.round((new Date(`${date}T12:00:00+07:00`) - new Date(`${todayInJakarta()}T12:00:00+07:00`)) / 864e5);
  const eventLastDay = (event) => (event.end_at ? jakartaDay(event.end_at) : event.event_date);
  const countdownLabel = (days) => (days === 0 ? "Hari ini" : days === 1 ? "Besok" : `${days} hari lagi`);
  const shortDate = (event) => new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "short", timeZone: "Asia/Jakarta" })
    .format(new Date(`${event.event_date}T12:00:00+07:00`));

  // Same rule as admin-certificate-issue (ISSUE_AFTER_DAYS): certificates open H+3.
  const CERTIFICATE_AFTER_DAYS = 3;
  // Reminders run from the first day until 30 days after the event.
  const homeWindow = (event) => {
    const sinceEnd = -daysFromToday(eventLastDay(event));
    if (daysFromToday(event.event_date) > 0 || sinceEnd > 30) return null;
    return { lifecycle: sinceEnd > 0 ? "history" : "active", certificates: sinceEnd >= CERTIFICATE_AFTER_DAYS };
  };
  // Per-event checks so these tasks disappear once the work is done: confirmed
  // registrants not marked present/absent yet, or present volunteers without a certificate.
  const loadHomeChecks = async () => {
    if (home.checksAt && Date.now() - home.checksAt < adminCacheTtl) return;
    const checks = new Map();
    await Promise.all(events.filter((event) => !event.archived_at && event.event_date).map(async (event) => {
      const span = homeWindow(event);
      if (!span) return;
      try {
        const data = await registrationRequest({ event: event.slug, lifecycle: span.lifecycle, registration_status: "confirmed" });
        const rows = Array.isArray(data.registrations) ? data.registrations : [];
        const check = {};
        const unmarked = rows.filter((row) => !attendanceState(row)).length;
        if (unmarked) check.attendance = { lifecycle: span.lifecycle, count: unmarked };
        if (span.certificates && rows.some((row) => row.attended_at)) {
          const issue = await authorizedRequest(issueUrl({ event: event.slug }));
          const pending = (issue.recipients || []).filter((recipient) => !recipient.certificate?.issued_at).length;
          if (pending) check.certificate = { count: pending };
        }
        if (check.attendance || check.certificate) checks.set(event.slug, check);
      } catch {
        // A failed check only hides that one reminder.
      }
    }));
    home.checks = checks;
    home.checksAt = Date.now();
  };

  const homeTasks = () => {
    const counts = seatCounts();
    const tasks = [];
    const unchecked = home.registrations.filter(proofUnchecked).length;
    if (unchecked) {
      tasks.push({ tone: "deadline", text: `<strong>${unchecked} bukti bayar</strong> belum dicek ke mutasi GoPay`, go: "registrations", event: "", payment: "unchecked" });
    }
    events.filter((event) => !event.archived_at && event.event_date).forEach((event) => {
      const title = `<strong>${escapeHtml(event.title)}</strong>`;
      const untilStart = daysFromToday(event.event_date);
      const check = home.checks.get(event.slug);
      if (check?.attendance) {
        tasks.push({ tone: "attendance", text: `Tandai kehadiran ${check.attendance.count} relawan ${title}`, go: "registrations", event: event.slug, lifecycle: check.attendance.lifecycle });
      }
      if (check?.certificate) {
        tasks.push({ tone: "certificate", text: `${check.certificate.count} sertifikat ${title} belum diterbitkan`, go: "certificates", event: event.slug });
      }
      if (untilStart < 0) return;
      if (!event.is_public) tasks.push({ tone: "draft", text: `${title} belum tampil di website`, go: "edit", event: event.slug });
      const closesAt = event.registration_deadline ? new Date(event.registration_deadline).getTime() : NaN;
      const deadline = closesAt > Date.now() ? daysFromToday(jakartaDay(event.registration_deadline)) : null;
      if (event.is_public && event.status === "open" && deadline !== null && deadline <= 3) {
        tasks.push({ tone: "deadline", text: `Pendaftaran ${title} tutup ${countdownLabel(deadline).toLowerCase()}`, go: "registrations", event: event.slug });
      }
      const count = counts[event.slug];
      const filled = count ? count.confirmed + count.held : 0;
      if (event.registration_mode !== "selection" && event.capacity && filled / event.capacity >= 0.8 && filled < event.capacity) {
        tasks.push({ tone: "hot", text: `${title} hampir penuh (${filled}/${escapeHtml(String(event.capacity))})`, go: "registrations", event: event.slug });
      }
    });
    return tasks.slice(0, 7);
  };

  const tokenClaims = (session) => {
    try { return JSON.parse(atob(String(session?.access_token || "").split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); }
    catch { return {}; }
  };
  // Nickname set on Beranda wins; otherwise a guess from the profile name or email.
  const homeName = () => {
    const session = readSession();
    // Invite/recovery sessions carry no user object; the access token itself holds the claims.
    const claims = tokenClaims(session);
    const meta = { ...claims.user_metadata, ...session?.user?.user_metadata };
    if (String(meta.nickname || "").trim()) return String(meta.nickname).trim();
    const fromMeta = String(meta.full_name || meta.name || "").trim().split(/\s+/)[0];
    const email = session?.user?.email || claims.email || "";
    const fromEmail = String(email).split("@")[0].split(/[._\-\d]/)[0];
    const name = fromMeta || fromEmail;
    return name ? name.charAt(0).toUpperCase() + name.slice(1).toLowerCase() : "tim";
  };
  // Stored per admin in Supabase Auth user_metadata (no table needed).
  const saveNickname = async (nickname) => {
    const token = await validAccessToken();
    if (!token) throw new Error("Sesi berakhir. Silakan masuk kembali.");
    const response = await fetch(`${CONFIG.supabaseUrl}/auth/v1/user`, {
      method: "PUT",
      headers: { apikey: CONFIG.publishableKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ data: { nickname } }),
    });
    const user = await response.json().catch(() => null);
    if (!response.ok || !user) throw new Error("Nama panggilan belum dapat disimpan.");
    const session = readSession();
    if (session) localStorage.setItem(CONFIG.sessionKey, JSON.stringify({ ...session, user }));
  };
  const nameButton = $("#home-name-edit");
  const nameInput = $("#home-name-input");
  const closeNameEdit = () => { nameInput.hidden = true; nameButton.hidden = false; };
  nameButton.addEventListener("click", () => {
    nameInput.value = homeName() === "tim" ? "" : homeName();
    nameButton.hidden = true;
    nameInput.hidden = false;
    nameInput.focus();
    nameInput.select();
  });
  nameInput.addEventListener("keydown", async (event) => {
    if (event.key === "Escape") { closeNameEdit(); nameButton.focus(); return; }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const nickname = nameInput.value.trim().replace(/\s+/g, " ");
    if (!nickname || nickname === homeName()) { closeNameEdit(); return; }
    nameInput.disabled = true;
    try {
      await saveNickname(nickname);
      $("#home-name").textContent = homeName();
      closeNameEdit();
      setFeedback($("#home-feedback"), `Oke, mulai sekarang kamu dipanggil ${nickname}.`, "success");
    } catch (error) {
      setFeedback($("#home-feedback"), error.message, "error");
      nameInput.disabled = false;
      nameInput.focus();
      return;
    }
    nameInput.disabled = false;
  });
  nameInput.addEventListener("blur", () => { if (!nameInput.disabled) closeNameEdit(); });

  const renderHomeHeader = () => {
    const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Jakarta" }).format(new Date()));
    $("#home-greeting").textContent = hour < 11 ? "Selamat pagi" : hour < 15 ? "Selamat siang" : hour < 18 ? "Selamat sore" : "Selamat malam";
    $("#home-name").textContent = homeName();
    $("#home-date").textContent = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" }).format(new Date());
  };

  const countUp = (root) => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    root.querySelectorAll("[data-count]").forEach((element) => {
      const target = Number(element.dataset.count);
      if (reduce || !target) { element.textContent = String(target); return; }
      const start = performance.now();
      const step = (now) => {
        const progress = Math.min(1, (now - start) / 700);
        element.textContent = String(Math.round(target * (1 - (1 - progress) ** 3)));
        if (progress < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  };

  const renderHome = () => {
    const now = Date.now();
    const registrations = home.registrations;
    const counts = seatCounts();
    const upcoming = events.filter((event) => !event.archived_at && event.event_date && daysFromToday(eventLastDay(event)) >= 0)
      .sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)));
    const fresh = registrations.filter((registration) => now - new Date(registration.created_at).getTime() < 864e5).length;
    const pending = registrations.filter((registration) => registration.registration_status === "pending_payment" && !registration.payment_expired).length;
    const applied = registrations.filter((registration) => registration.registration_status === "applied").length;
    const seats = upcoming.filter((event) => event.registration_mode !== "selection" && event.capacity)
      .reduce((sum, event) => ({
        filled: sum.filled + (counts[event.slug]?.confirmed || 0) + (counts[event.slug]?.held || 0),
        total: sum.total + Number(event.capacity),
      }), { filled: 0, total: 0 });
    const stat = (key, value, label, hint, attention = false) => `
      <button class="home-stat${attention ? " is-attention" : ""}" type="button" data-home-stat="${key}">
        <span class="home-stat-value"><span data-count="${value}">0</span></span>
        <span class="home-stat-label">${label}</span>
        <span class="home-stat-hint">${hint}</span>
      </button>`;
    const stats = $("#home-stats");
    stats.innerHTML = [
      stat("new", fresh, "Pendaftar baru", "24 jam terakhir"),
      stat("pending", pending, "Menunggu bayar", "QRIS belum lunas", pending > 0),
      stat("applied", applied, "Menunggu seleksi", "belum diputuskan", applied > 0),
      `<button class="home-stat" type="button" data-home-stat="seats">
        <span class="home-stat-value"><span data-count="${seats.filled}">0</span><small>/${seats.total}</small></span>
        <span class="home-stat-label">Kursi terisi</span>
        <span class="home-stat-hint">kegiatan mendatang</span>
      </button>`,
    ].join("");
    countUp(stats);

    const upcomingList = $("#home-upcoming");
    upcomingList.innerHTML = upcoming.length ? upcoming.slice(0, 3).map((event) => {
      const days = daysFromToday(event.event_date);
      const time = event.start_time ? ` · ${escapeHtml(String(event.start_time).slice(0, 5).replace(":", "."))}` : "";
      return `
      <article class="home-event">
        ${posterMarkup(event, "home-event-poster")}
        <div class="home-event-body">
          <p class="home-event-when"><span class="home-countdown${days <= 3 ? " is-soon" : ""}">${days < 0 ? "Berlangsung" : countdownLabel(days)}</span>${escapeHtml(shortDate(event))}${time}</p>
          <h3>${escapeHtml(event.title)}</h3>
          <p class="home-event-meta">${escapeHtml(event.location || "Lokasi belum diatur")} · <span class="state-label${event.is_public ? " is-public" : ""}">${event.is_public ? "Tayang" : "Belum tayang"}</span></p>
          ${capacityMarkup(event, counts[event.slug])}
          <div class="home-event-actions">
            <button class="text-button" type="button" data-home-go="registrations" data-home-event="${escapeHtml(event.slug)}">Lihat pendaftar →</button>
            <button class="text-button" type="button" data-home-go="edit" data-home-event="${escapeHtml(event.slug)}">Edit</button>
          </div>
        </div>
      </article>`;
    }).join("") : `<div class="home-empty"><p>Belum ada kegiatan mendatang.</p><button class="button button-primary" type="button" data-home-add-event>Bikin kegiatan baru</button></div>`;
    applyCapacityBars(upcomingList);

    const tasks = homeTasks();
    $("#home-tasks").innerHTML = tasks.length ? tasks.map((task) => `
      <li><button class="home-task is-${task.tone}" type="button" data-home-go="${task.go}" data-home-event="${escapeHtml(task.event)}"${task.lifecycle ? ` data-home-lifecycle="${task.lifecycle}"` : ""}${task.payment ? ` data-home-payment="${task.payment}"` : ""}>
        <span class="home-task-dot" aria-hidden="true"></span><span class="home-task-text">${task.text}</span><span class="home-task-arrow" aria-hidden="true">→</span>
      </button></li>`).join("")
      : `<li class="home-all-done"><span aria-hidden="true">☕</span> Aman semua. Ngopi dulu ges.</li>`;
    $("#home-summary").textContent = tasks.length
      ? `Ada ${tasks.length} hal yang perlu diurus. Gas, satu-satu.`
      : "Semua aman terkendali. Mantap, bangga gua"; 
  };

  const showHome = async () => {
    [formView, eventsView, registrationsView, storiesView, storyFormView, adminsView, certificatesView].forEach((view) => { view.hidden = true; });
    homeView.hidden = false;
    setActiveNavigation("home");
    window.scrollTo({ top: 0, behavior: "instant" });
    renderHomeHeader();
    setFeedback($("#home-feedback"));
    let problem = "";
    try {
      await Promise.all([loadEvents(), loadHomeRegistrations()]);
      // loadEvents reports its own errors on the (hidden) Kegiatan tab.
      if (!tabCache.events.loadedAt) problem = "Data kegiatan belum bisa dimuat.";
      else await loadHomeChecks();
    } catch (error) {
      problem = error.message;
    }
    if (homeView.hidden) return;
    if (problem) {
      // Never show zeros and "all good" on top of missing data.
      setFeedback($("#home-feedback"), `${problem} Coba muat ulang halaman.`, "error");
      $("#home-summary").textContent = "Ringkasan belum lengkap.";
      ["#home-stats", "#home-upcoming", "#home-tasks"].forEach((selector) => { $(selector).innerHTML = ""; });
      return;
    }
    renderHome();
  };

  // Shortcuts from Beranda into a filtered tab.
  const openRegistrations = async ({ event = "", status = "", lifecycle = "active", payment = "" } = {}) => {
    $("#registration-search").value = "";
    $("#payment-status-filter").value = payment;
    $("#registration-status-filter").value = status;
    registrationLifecycle = lifecycle;
    document.querySelectorAll("[data-registration-lifecycle]").forEach((tab) => {
      const active = tab.dataset.registrationLifecycle === lifecycle;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    if (!tabCache.events.loadedAt) await loadEvents();
    $("#registration-event-filter").value = event;
    await showRegistrations();
  };
  const openCertificates = async (slug) => {
    await showCertificates();
    const select = $("#certificate-event");
    if (slug && select.value !== slug && [...select.options].some((option) => option.value === slug)) {
      select.value = slug;
      await loadCertificateSettings();
    }
  };

  homeView.addEventListener("click", (event) => {
    if (event.target.closest("[data-home-add-event]")) return showForm();
    const stat = event.target.closest("[data-home-stat]");
    if (stat) {
      const key = stat.dataset.homeStat;
      if (key === "seats") return showEvents();
      return void openRegistrations({ status: key === "pending" ? "pending_payment" : key === "applied" ? "applied" : "" });
    }
    const go = event.target.closest("[data-home-go]");
    if (!go) return;
    event.preventDefault();
    const slug = go.dataset.homeEvent || "";
    if (go.dataset.homeGo === "events") return showEvents();
    if (go.dataset.homeGo === "certificates") return void openCertificates(slug);
    if (go.dataset.homeGo === "edit") {
      const target = events.find((item) => item.slug === slug);
      return target ? showForm(target) : showEvents();
    }
    return void openRegistrations({ event: slug, lifecycle: go.dataset.homeLifecycle || "active", payment: go.dataset.homePayment || "" });
  });

  const showEvents = () => {
    formView.hidden = true;
    registrationsView.hidden = true;
    adminsView.hidden = true;
    certificatesView.hidden = true;
    storiesView.hidden = true;
    storyFormView.hidden = true;
    eventsView.hidden = false;
    homeView.hidden = true;
    setActiveNavigation("events");
    window.scrollTo({ top: 0, behavior: "instant" });
    $("#add-event-button").focus();
    void loadEvents();
    // Seat counts for the capacity bars arrive separately; redraw once they do.
    void loadHomeRegistrations().then(() => { if (!eventsView.hidden) renderEvents(); }).catch(() => undefined);
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
    homeView.hidden = true;
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
    homeView.hidden = true;
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
    const relatedEvent = $("#story-event-id");
    relatedEvent.innerHTML = `<option value="">Tidak terkait kegiatan</option>${events.map((event) =>
      `<option value="${escapeHtml(event.id)}">${escapeHtml(`${event.title} · ${formatDate(event.event_date)}`)}</option>`).join("")}`;
    // Keep a saved link even when that event is not in the loaded list, so saving never drops it.
    if (story?.event_id && !events.some((event) => event.id === story.event_id)) {
      relatedEvent.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(story.event_id)}">Kegiatan terkait (tersimpan)</option>`);
    }
    relatedEvent.value = story?.event_id || "";
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
    markDirty(storyForm, false);
    eventsView.hidden = true;
    homeView.hidden = true;
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
    homeView.hidden = true;
    formView.hidden = true;
    registrationsView.hidden = true;
    adminsView.hidden = true;
    certificatesView.hidden = true;
    storyFormView.hidden = true;
    storiesView.hidden = false;
    setActiveNavigation("stories");
    window.scrollTo({ top: 0, behavior: "instant" });
    // The story form lists events for "Kegiatan terkait".
    await Promise.all([loadStories(), tabCache.events.loadedAt ? null : loadEvents()]);
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
    program_key: $("#event-program-key").value || null,
    documentation_url: $("#event-documentation-url").value.trim() || null,
    documentation_photos: docPhotos.map((photo) => ({ url: photo.url, alt: photo.alt.trim() })),
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
    event_id: $("#story-event-id").value || null,
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

  function renderDocPhotos() {
    const list = $("#doc-photos");
    list.replaceChildren(...docPhotos.map((photo, index) => {
      const item = document.createElement("li");
      item.className = "doc-photo";
      const img = document.createElement("img");
      img.src = photo.url;
      img.alt = "";
      img.loading = "lazy";
      const alt = document.createElement("input");
      alt.value = photo.alt;
      alt.maxLength = 200;
      alt.placeholder = "Keterangan singkat (opsional)";
      alt.setAttribute("aria-label", `Keterangan foto ${index + 1}`);
      alt.dataset.docAlt = String(index);
      const actions = document.createElement("div");
      actions.className = "doc-photo-actions";
      actions.innerHTML = `${index > 0 ? `<button class="text-button" type="button" data-doc-move="${index}" aria-label="Geser foto ${index + 1} ke kiri">← Geser</button>` : ""}<button class="text-button delete-signer" type="button" data-doc-remove="${index}" aria-label="Hapus foto ${index + 1}">Hapus</button>`;
      item.append(img, alt, actions);
      return item;
    }));
    const left = DOC_PHOTO_LIMIT - docPhotos.length;
    $("#doc-photo-status").textContent = docPhotos.length ? `${docPhotos.length}/${DOC_PHOTO_LIMIT} foto${left ? "" : " · sudah maksimal"}` : "Belum ada foto.";
    document.querySelector('label[for="doc-photo-file"]').hidden = left <= 0;
  }
  $("#doc-photos").addEventListener("input", (event) => {
    const index = event.target.dataset.docAlt;
    if (index !== undefined && docPhotos[index]) docPhotos[index].alt = event.target.value;
  });
  $("#doc-photos").addEventListener("click", (event) => {
    const move = event.target.closest("[data-doc-move]");
    const remove = event.target.closest("[data-doc-remove]");
    if (!move && !remove) return;
    const index = Number((move || remove).dataset[move ? "docMove" : "docRemove"]);
    if (move) [docPhotos[index - 1], docPhotos[index]] = [docPhotos[index], docPhotos[index - 1]];
    else docPhotos.splice(index, 1);
    markDirty(eventForm, true);
    renderDocPhotos();
  });
  $("#doc-photo-file").addEventListener("change", async (event) => {
    const files = [...(event.target.files || [])].slice(0, DOC_PHOTO_LIMIT - docPhotos.length);
    event.target.value = "";
    if (!files.length) return;
    const button = $("#save-button");
    const status = $("#doc-photo-status");
    imageUploading += 1;
    button.disabled = true;
    status.classList.remove("is-error");
    try {
      for (const [index, file] of files.entries()) {
        status.textContent = `Mengompres dan mengunggah foto ${index + 1}/${files.length}…`;
        const url = await uploadImage(file, { bucket: "event-images", slugInput: "#event-slug", maxWidth: 1600, maxHeight: 1600 });
        docPhotos.push({ url, alt: "" });
        markDirty(eventForm, true);
      }
      renderDocPhotos();
    } catch (error) {
      renderDocPhotos();
      status.classList.add("is-error");
      status.textContent = error.message;
    } finally {
      imageUploading -= 1;
      button.disabled = imageUploading > 0;
    }
  });

  $("#event-image-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const button = $("#save-button");
    const status = $("#image-upload-status");
    imageUploading += 1;
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
      imageUploading -= 1;
      button.disabled = imageUploading > 0;
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
      }
    }
    // Solid marks touching the photo's edge are the paper edge, table or shadow, not the
    // signature: flood-fill them (plus the faint pixels right beside them) to transparent.
    // Only solid ink spreads the fill, so a soft shadow cannot link the edge to the signature.
    const SOLID = 40;
    const stack = [];
    const seed = (x, y) => { if (pixels[(y * width + x) * 4 + 3] > SOLID) stack.push(y * width + x); };
    for (let x = 0; x < width; x += 1) { seed(x, 0); seed(x, height - 1); }
    for (let y = 0; y < height; y += 1) { seed(0, y); seed(width - 1, y); }
    while (stack.length) {
      const point = stack.pop();
      if (pixels[point * 4 + 3] === 0) continue;
      pixels[point * 4 + 3] = 0;
      const x = point % width;
      const y = (point - x) / width;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbour = (ny * width + nx) * 4 + 3;
          if (pixels[neighbour] > SOLID) stack.push(ny * width + nx);
          else pixels[neighbour] = 0;
        }
      }
    }
    // Ruled lines inside the photo (a printed signature box, a line to sign on, another sheet's
    // edge): long, perfectly straight and thin horizontal/vertical runs. A pen stroke can be
    // straight for a while but is thicker, so thickness is checked across each run.
    const minRunX = Math.max(150, Math.round(width * 0.25));
    const minRunY = Math.max(150, Math.round(height * 0.25));
    const MAX_LINE = 5;
    const solidAt = (x, y) => x >= 0 && y >= 0 && x < width && y < height && pixels[(y * width + x) * 4 + 3] > SOLID;
    // Median thickness across the run, measured perpendicular to it at 15 points.
    const thin = (horizontal, fixed, from, to) => {
      const samples = [];
      for (let step = 1; step <= 15; step += 1) {
        const along = Math.round(from + ((to - from) * step) / 16);
        let size = 1;
        for (let offset = 1; offset <= MAX_LINE + 1; offset += 1) {
          if (horizontal ? solidAt(along, fixed - offset) : solidAt(fixed - offset, along)) size += 1; else break;
        }
        for (let offset = 1; offset <= MAX_LINE + 1; offset += 1) {
          if (horizontal ? solidAt(along, fixed + offset) : solidAt(fixed + offset, along)) size += 1; else break;
        }
        samples.push(size);
      }
      samples.sort((a, b) => a - b);
      return samples[7] <= MAX_LINE;
    };
    const ruled = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width;) {
        if (!solidAt(x, y)) { x += 1; continue; }
        const start = x;
        while (x < width && solidAt(x, y)) x += 1;
        if (x - start >= minRunX && thin(true, y, start, x - 1)) ruled.push([start, x - 1, y, y]);
      }
    }
    for (let x = 0; x < width; x += 1) {
      for (let y = 0; y < height;) {
        if (!solidAt(x, y)) { y += 1; continue; }
        const start = y;
        while (y < height && solidAt(x, y)) y += 1;
        if (y - start >= minRunY && thin(false, x, start, y - 1)) ruled.push([x, x, start, y - 1]);
      }
    }
    // Clear each line only where it is thin; where a pen stroke crosses it (thicker there),
    // the stroke stays whole.
    const clearAcross = (horizontal, fixed, along) => {
      let before = 0;
      let after = 0;
      while (before <= MAX_LINE && (horizontal ? solidAt(along, fixed - before - 1) : solidAt(fixed - before - 1, along))) before += 1;
      while (after <= MAX_LINE && (horizontal ? solidAt(along, fixed + after + 1) : solidAt(fixed + after + 1, along))) after += 1;
      if (before + after + 1 > MAX_LINE) return;
      for (let offset = -before - 1; offset <= after + 1; offset += 1) {
        const x = horizontal ? along : fixed + offset;
        const y = horizontal ? fixed + offset : along;
        if (x >= 0 && y >= 0 && x < width && y < height) pixels[(y * width + x) * 4 + 3] = 0;
      }
    };
    ruled.forEach(([x0, x1, y0, y1]) => {
      if (y0 === y1) for (let x = x0; x <= x1; x += 1) clearAcross(true, y0, x);
      else for (let y = y0; y <= y1; y += 1) clearAcross(false, x0, y);
    });
    // Soft shadow left on the paper is dropped, then tiny isolated specks (dust, JPEG noise).
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] < 28) pixels[index] = 0;
    const MIN_SPECK = 24;
    const seen = new Uint8Array(width * height);
    for (let start = 0; start < width * height; start += 1) {
      if (seen[start] || pixels[start * 4 + 3] <= SOLID) continue;
      const component = [start];
      seen[start] = 1;
      for (let cursor = 0; cursor < component.length; cursor += 1) {
        const point = component[cursor];
        const x = point % width;
        const y = (point - x) / width;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            const ny = y + dy;
            const next = ny * width + nx;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height || seen[next] || pixels[next * 4 + 3] <= SOLID) continue;
            seen[next] = 1;
            component.push(next);
          }
        }
      }
      if (component.length < MIN_SPECK) component.forEach((point) => { pixels[point * 4 + 3] = 0; });
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (pixels[(y * width + x) * 4 + 3] > SOLID) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) throw new Error("Tanda tangan tidak terbaca. Pakai pulpen gelap di kertas putih polos, jangan sampai menyentuh tepi foto.");
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
    fillCertificateSigners();
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
        <div class="signer-actions">
          <button class="button button-secondary" type="button" data-toggle-signer="${escapeHtml(signer.id)}" data-signer-active="${signer.is_active ? "false" : "true"}"${signerPending ? " disabled" : ""}>${signer.is_active ? "Nonaktifkan" : "Aktifkan lagi"}</button>
          ${signer.is_active ? "" : `<button class="text-button delete-signer" type="button" data-delete-signer="${escapeHtml(signer.id)}"${signerPending ? " disabled" : ""}>Hapus</button>`}
        </div>
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
    homeView.hidden = true;
    registrationsView.hidden = true;
    storiesView.hidden = true;
    storyFormView.hidden = true;
    adminsView.hidden = true;
    certificatesView.hidden = false;
    setActiveNavigation("certificates");
    window.scrollTo({ top: 0, behavior: "instant" });
    // Signed preview URLs last 10 minutes, so everything is fetched fresh on every visit.
    await loadEvents();
    fillCertificateEvents();
    if ($("#certificate-event").value) await loadCertificateSettings();
    else await loadSigners();
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
    const button = event.target.closest("[data-toggle-signer], [data-delete-signer]");
    if (!button || signerPending) return;
    const deleteId = button.dataset.deleteSigner;
    if (deleteId) {
      const name = signers.find((signer) => signer.id === deleteId)?.name || "tanda tangan ini";
      if (!(await confirmAction(`Tanda tangan ${name} dihapus permanen. Sertifikat yang sudah terbit tidak berubah.`, { title: "Hapus tanda tangan?", confirmLabel: "Hapus", danger: true }))) return;
    }
    signerPending = true;
    renderSigners();
    const feedback = $("#signers-feedback");
    try {
      const data = deleteId
        ? await certificatesRequest("DELETE", { id: deleteId })
        : await certificatesRequest("PATCH", { id: button.dataset.toggleSigner, body: { is_active: button.dataset.signerActive === "true" } });
      if (Array.isArray(data.signers)) signers = data.signers;
      else void loadSigners();
      if (deleteId) setFeedback(feedback, "Tanda tangan dihapus.", "success");
      else setFeedback(feedback);
    } catch (error) {
      setFeedback(feedback, error.message, "error");
    } finally {
      signerPending = false;
      renderSigners();
    }
  });

  // Sertifikat → per-event settings with a live preview drawn by js/certificate.js.
  const logoUrls = {
    color: "../assets/logo/2.%20Logo%20Gabungan/Logo%20Kita%20Bahagiaa.png",
    white: "../assets/logo/2.%20Logo%20Gabungan/20.png",
  };
  const certificate = {
    // Slug whose settings fill the form; saving is blocked until it matches the selected event.
    loadedSlug: "",
    settings: null,
    ornamentUpload: null,
    logoUpload: null,
    templateUpload: null,
    removePartnerLogo: false,
    loadSeq: 0,
    renderSeq: 0,
    uploadReads: { ornament: 0, logo: 0, template: 0 },
    pending: false,
    // Canva template: top-left corners of the name and QR boxes (sizes come from the inputs).
    namePos: { x: 170, y: 600 },
    qrPos: { x: 1700, y: 1130 },
    nameLines: 1,
    drag: null,
  };
  const DEFAULT_NAME_LAYOUT = { x: 170, y: 600, width: 1300, align: "left", color: "#780c06", size: 118 };
  const DEFAULT_QR_LAYOUT = { x: 1700, y: 1130, size: 180, caption: true };
  const templateMode = () => $("#certificate-template-mode").value;
  const clampNumber = (value, min, max) => Math.round(Math.min(max, Math.max(min, value)));
  // Same bounds as admin-certificates checks.
  const currentLayouts = () => {
    const width = Number($("#certificate-name-width").value);
    const qrSize = Number($("#certificate-qr-size").value);
    return {
      name: {
        x: clampNumber(certificate.namePos.x, 0, Math.min(1800, 2000 - width)),
        // Room for two lines, since a long name wraps.
        y: clampNumber(certificate.namePos.y, 0, 1414 - Math.round(Number($("#certificate-name-size").value) * 1.1) * 2),
        width,
        align: $("#certificate-name-align").value,
        color: $("#certificate-name-color").value.toLowerCase(),
        size: Number($("#certificate-name-size").value),
      },
      qr: {
        x: clampNumber(certificate.qrPos.x, 0, 2000 - qrSize),
        // The caption under the QR needs about 56px more.
        y: clampNumber(certificate.qrPos.y, 0, 1414 - qrSize - ($("#certificate-qr-caption").checked ? 56 : 0)),
        size: qrSize,
        caption: $("#certificate-qr-caption").checked,
      },
    };
  };
  const imageCache = new Map();
  // fetch + ImageBitmap (not <img>): the canvas stays exportable to PDF, and no blob: URL is needed under the CSP.
  const loadImage = (url) => {
    if (!url) return Promise.resolve(null);
    if (!imageCache.has(url)) {
      const request = fetch(url)
        .then((response) => (response.ok ? response.blob() : null))
        .then((blob) => (blob ? createImageBitmap(blob) : null))
        .catch(() => null);
      // Failures are not cached, so a later try (e.g. with a fresh signed URL) can succeed.
      imageCache.set(url, request.then((image) => {
        if (!image) imageCache.delete(url);
        return image;
      }));
    }
    return imageCache.get(url);
  };

  const certificateEvents = () => events.filter((event) => !event.archived_at)
    .sort((a, b) => String(b.event_date).localeCompare(String(a.event_date)));
  const selectedCertificateEvent = () => events.find((event) => event.slug === $("#certificate-event").value) || null;
  const signerById = (id) => signers.find((signer) => signer.id === id) || null;

  const fillCertificateEvents = () => {
    const select = $("#certificate-event");
    const current = select.value;
    const list = certificateEvents();
    select.innerHTML = list.map((event) =>
      `<option value="${escapeHtml(event.slug)}">${escapeHtml(formatDate(event.event_date))} · ${escapeHtml(event.title)}</option>`).join("");
    if (list.some((event) => event.slug === current)) select.value = current;
    $("#certificate-no-events").hidden = list.length > 0;
    $("#certificate-settings-form").hidden = list.length === 0;
  };

  // Active signers of a role, plus the one already saved even if it was deactivated since.
  const fillCertificateSigners = () => {
    [["#certificate-founder", "founder", "founder_id", "Pilih Founder"],
      ["#certificate-leader", "project_leader", "project_leader_id", "Pilih Project Leader"],
      ["#certificate-partner", "partner", "partner_signer_id", "Tanpa mitra"]].forEach(([selector, role, field, empty]) => {
      const select = $(selector);
      const current = select.value || certificate.settings?.[field] || "";
      const options = signers.filter((signer) => signer.role === role && (signer.is_active || signer.id === current));
      select.innerHTML = `<option value="">${empty}</option>${options.map((signer) =>
        `<option value="${escapeHtml(signer.id)}">${escapeHtml(signer.name)}${signer.organization ? ` · ${escapeHtml(signer.organization)}` : ""}${signer.is_active ? "" : " (nonaktif)"}</option>`).join("")}`;
      select.value = options.some((signer) => signer.id === current) ? current : "";
      // A single active founder is the obvious default.
      if (!select.value && role === "founder" && options.length === 1) select.value = options[0].id;
    });
  };

  const syncCertificateForm = () => {
    const canva = templateMode() === "canva";
    $("#certificate-canva-fields").hidden = !canva;
    $("#certificate-system-fields").hidden = canva;
    // Canva designs print the number themselves; the typed one is what the verification page shows.
    $("#certificate-number-note").hidden = !canva;
    $("#certificate-number-hint").hidden = !canva;
    $("#certificate-canvas").classList.toggle("is-draggable", canva);
    const custom = $("#certificate-ornament").value === "custom";
    $("#certificate-color-field").hidden = custom;
    $("#certificate-ornament-field").hidden = !custom;
    const partner = Boolean($("#certificate-partner").value);
    $("#certificate-partner-logo-field").hidden = !partner;
    $("#certificate-partner-logo-remove").hidden = !(certificate.logoUpload
      || (certificate.settings?.partner_logo_url && !certificate.removePartnerLogo));
    $("#certificate-save").disabled = certificate.pending || certificate.loadedSlug !== $("#certificate-event").value;
  };

  const certificateSpecImages = async () => {
    const pick = (id) => signerById(id);
    const founder = pick($("#certificate-founder").value);
    const partner = pick($("#certificate-partner").value);
    const leader = pick($("#certificate-leader").value);
    const column = async (signer, fallbackTitle) => ({
      title: signer?.title || fallbackTitle,
      name: signer?.name || "",
      signature: await loadImage(signer?.signature_url),
      stamp: await loadImage(signer?.stamp_url),
    });
    const columns = [await column(founder, "Founder Kita Bahagia")];
    if (partner) columns.push(await column(partner, "Mitra"));
    columns.push(await column(leader, "Project Leader"));
    const custom = $("#certificate-ornament").value === "custom";
    const ornament = custom
      ? certificate.ornamentUpload?.canvas || await loadImage(certificate.settings?.ornament_url)
      : null;
    const partnerLogo = partner
      ? certificate.logoUpload?.canvas || (certificate.removePartnerLogo ? null : await loadImage(certificate.settings?.partner_logo_url))
      : null;
    const [color, white] = await Promise.all([loadImage(logoUrls.color), loadImage(logoUrls.white)]);
    const template = templateMode() === "canva"
      ? certificate.templateUpload?.canvas || await loadImage(certificate.settings?.template_url)
      : null;
    return { columns, ornament, partnerLogo, partner, logos: { color, white }, template };
  };

  const certificateOpening = (event) => KBCertificate.openingRuns({
    category: event.category, title: event.title, eventDate: event.event_date, endAt: event.end_at,
    location: event.location, partner: signerById($("#certificate-partner").value)?.organization,
  });

  // The form (= saved settings when issuing) plus one name, number and QR link.
  const certificateSpec = async (event, { name, number, qrUrl, guides = false }) => {
    const [images] = await Promise.all([certificateSpecImages(), KBCertificate.loadFonts()]);
    return {
      images,
      spec: {
        template: templateMode() === "canva" ? { image: images.template, ...currentLayouts() } : null,
        guides,
        number,
        name,
        opening: certificateOpening(event),
        description: $("#certificate-description").value.trim(),
        ornament: { preset: $("#certificate-ornament").value, color: $("#certificate-color").value, image: images.ornament },
        logoVariant: $("#certificate-logo").value,
        logos: images.logos,
        partnerLogo: images.partnerLogo,
        signers: images.columns,
        qrUrl,
      },
    };
  };

  const renderCertificatePreview = async () => {
    const event = selectedCertificateEvent();
    if (!event || !window.KBCertificate) return;
    const seq = ++certificate.renderSeq;
    syncCertificateForm();
    $("#certificate-opening").textContent = certificateOpening(event).map((run) => run.text).join("");
    const { images, spec } = await certificateSpec(event, {
      name: $("#certificate-sample-name").value.trim() || "Nama Relawan",
      number: $("#certificate-number").value.trim(),
      qrUrl: "https://kitabahagia.id/sertifikat?k=CONTOH",
      guides: true,
    });
    if (seq !== certificate.renderSeq) return;
    const layout = KBCertificate.render($("#certificate-canvas"), spec);
    certificate.nameLines = layout.nameLines;
    $("#certificate-preview").hidden = false;
    const canva = templateMode() === "canva";
    const warnings = (canva ? [
      !$("#certificate-number").value.trim() && "Nomor sertifikat belum diisi (dipakai di halaman cek keaslian; samakan dengan nomor di desain).",
      !images.template && "Desain dari Canva belum diunggah.",
      certificate.templateUpload?.stretched && "Ukuran desain bukan A4 landscape, jadi gambarnya diregangkan. Minta export ulang ukuran A4 ke Desain.",
    ] : [
      !$("#certificate-number").value.trim() && "Nomor sertifikat belum diisi.",
      !$("#certificate-founder").value && "Founder belum dipilih.",
      !$("#certificate-leader").value && "Project Leader belum dipilih.",
      images.partner && !images.partnerLogo && "Logo mitra belum diunggah.",
      $("#certificate-ornament").value === "custom" && !images.ornament && "File ornamen khusus belum dipilih.",
      layout.overflow && "Deskripsi terlalu panjang untuk sertifikat. Persingkat deskripsi lanjutan.",
    ]).filter(Boolean);
    $("#certificate-warnings").innerHTML = warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");
    const saved = certificate.settings;
    $("#certificate-meta").textContent = saved
      ? `Disimpan ${formatDateTime(saved.updated_at)} oleh ${String(saved.updated_by || "").split("@")[0]}`
      : "Belum disimpan untuk kegiatan ini.";
  };
  let certificateFrame = 0;
  const scheduleCertificatePreview = () => {
    cancelAnimationFrame(certificateFrame);
    certificateFrame = requestAnimationFrame(() => { void renderCertificatePreview(); });
  };

  const applyCertificateSettings = (settings) => {
    certificate.settings = settings;
    certificate.ornamentUpload = null;
    certificate.logoUpload = null;
    certificate.removePartnerLogo = false;
    certificate.templateUpload = null;
    certificate.uploadReads.ornament += 1;
    certificate.uploadReads.logo += 1;
    certificate.uploadReads.template += 1;
    $("#certificate-ornament-file").value = "";
    $("#certificate-partner-logo").value = "";
    $("#certificate-template-file").value = "";
    $("#certificate-template-mode").value = settings?.template_mode === "canva" ? "canva" : "system";
    const nameLayout = settings?.name_layout || DEFAULT_NAME_LAYOUT;
    const qrLayout = settings?.qr_layout || DEFAULT_QR_LAYOUT;
    certificate.namePos = { x: nameLayout.x, y: nameLayout.y };
    certificate.qrPos = { x: qrLayout.x, y: qrLayout.y };
    $("#certificate-name-width").value = nameLayout.width;
    $("#certificate-name-align").value = nameLayout.align;
    $("#certificate-name-color").value = nameLayout.color;
    $("#certificate-name-size").value = nameLayout.size;
    $("#certificate-qr-size").value = qrLayout.size;
    $("#certificate-qr-caption").checked = qrLayout.caption;
    $("#certificate-number").value = settings?.certificate_number || "";
    $("#certificate-description").value = settings?.description || "";
    $("#certificate-ornament").value = settings?.ornament_url ? "custom" : settings?.ornament_preset || "kelopak";
    $("#certificate-color").value = settings?.ornament_color || "maroon";
    $("#certificate-logo").value = settings?.logo_variant || "color";
    ["#certificate-founder", "#certificate-leader", "#certificate-partner"].forEach((selector) => { $(selector).value = ""; });
    fillCertificateSigners();
  };

  const loadCertificateSettings = async () => {
    const slug = $("#certificate-event").value;
    if (!slug) return;
    const seq = ++certificate.loadSeq;
    certificate.loadedSlug = "";
    issuance.data = null;
    issuance.names = {};
    renderRecipients();
    syncCertificateForm();
    const feedback = $("#certificate-settings-feedback");
    setFeedback(feedback, "Memuat pengaturan…");
    try {
      const url = new URL(adminCertificatesUrl);
      url.searchParams.set("event", slug);
      const data = await authorizedRequest(url);
      if (seq !== certificate.loadSeq) return;
      signers = Array.isArray(data.signers) ? data.signers : signers;
      applyCertificateSettings(data.settings || null);
      certificate.loadedSlug = slug;
      renderSigners();
      setFeedback(feedback);
      scheduleCertificatePreview();
      void loadRecipients();
    } catch (error) {
      if (seq === certificate.loadSeq) setFeedback(feedback, error.message, "error");
    }
  };

  // Uploaded images are redrawn as PNG in the browser (size cap, no metadata).
  const imageToPng = async (file, maxWidth, maxHeight, types) => {
    if (!types.includes(file.type)) throw new Error("Format gambar tidak didukung.");
    if (file.size > MAX_SOURCE_BYTES) throw new Error("Ukuran gambar maksimal 25 MB.");
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new Error("Gambar tidak dapat dibaca.");
    }
    let scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
    try {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await encodeCanvas(canvas, "image/png");
        if (blob && blob.size <= 2 * 1024 * 1024) return { canvas, blob };
        scale *= 0.75;
      }
    } finally {
      bitmap.close();
    }
    throw new Error("Gambar terlalu besar setelah diperkecil. Minta versi yang lebih ringan ke Desain.");
  };

  // A Canva design becomes a 2000×1414 JPEG (the size the certificate is drawn at).
  const imageToTemplate = async (file) => {
    if (!["image/png", "image/jpeg"].includes(file.type)) throw new Error("Desain harus PNG atau JPG.");
    if (file.size > MAX_SOURCE_BYTES) throw new Error("Ukuran desain maksimal 25 MB.");
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new Error("Desain tidak dapat dibaca.");
    }
    const ratio = bitmap.width / bitmap.height;
    const canvas = document.createElement("canvas");
    canvas.width = KBCertificate.WIDTH;
    canvas.height = KBCertificate.HEIGHT;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    for (const quality of [0.92, 0.85, 0.75]) {
      const blob = await encodeCanvas(canvas, "image/jpeg", quality);
      if (blob && blob.size <= 3 * 1024 * 1024) {
        return { canvas, blob, stretched: Math.abs(ratio - canvas.width / canvas.height) > 0.03 };
      }
    }
    throw new Error("Desain terlalu besar. Minta export ulang ke Desain.");
  };

  const readCertificateUpload = async (input, key, maxWidth, maxHeight, types) => {
    const feedback = $("#certificate-settings-feedback");
    const read = ++certificate.uploadReads[key];
    const field = { ornament: "ornamentUpload", logo: "logoUpload", template: "templateUpload" }[key];
    certificate[field] = null;
    const file = input.files?.[0];
    if (!file) return scheduleCertificatePreview();
    setFeedback(feedback, "Memproses gambar…");
    try {
      const result = key === "template" ? await imageToTemplate(file) : await imageToPng(file, maxWidth, maxHeight, types);
      if (read !== certificate.uploadReads[key]) return;
      certificate[field] = result;
      if (key === "logo") certificate.removePartnerLogo = false;
      setFeedback(feedback);
    } catch (error) {
      if (read !== certificate.uploadReads[key]) return;
      input.value = "";
      setFeedback(feedback, error.message, "error");
    }
    scheduleCertificatePreview();
  };

  $("#certificate-event").addEventListener("change", () => { void loadCertificateSettings(); });
  ["#certificate-number", "#certificate-sample-name", "#certificate-description"].forEach((selector) => {
    $(selector).addEventListener("input", scheduleCertificatePreview);
  });
  ["#certificate-founder", "#certificate-leader", "#certificate-partner", "#certificate-color", "#certificate-logo"].forEach((selector) => {
    $(selector).addEventListener("change", scheduleCertificatePreview);
  });
  $("#certificate-ornament").addEventListener("change", (event) => {
    // Dark blocks read better with the white logo; petals with the colour logo.
    if (event.currentTarget.value !== "custom") $("#certificate-logo").value = event.currentTarget.value === "balok" ? "white" : "color";
    scheduleCertificatePreview();
  });
  $("#certificate-template-mode").addEventListener("change", scheduleCertificatePreview);
  $("#certificate-template-file").addEventListener("change", (event) => {
    void readCertificateUpload(event.currentTarget, "template");
  });
  ["#certificate-name-size", "#certificate-name-width", "#certificate-qr-size", "#certificate-name-color"].forEach((selector) => {
    $(selector).addEventListener("input", scheduleCertificatePreview);
  });
  ["#certificate-name-align", "#certificate-qr-caption"].forEach((selector) => {
    $(selector).addEventListener("change", scheduleCertificatePreview);
  });
  // Drag the Nama / QR boxes on the preview (Canva template). Canvas pixels = certificate pixels.
  const canvasPoint = (event) => {
    const box = $("#certificate-canvas").getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) * KBCertificate.WIDTH) / box.width,
      y: ((event.clientY - box.top) * KBCertificate.HEIGHT) / box.height,
    };
  };
  $("#certificate-canvas").addEventListener("pointerdown", (event) => {
    if (templateMode() !== "canva") return;
    const point = canvasPoint(event);
    const { name, qr } = currentLayouts();
    const nameHeight = Math.round(name.size * 1.1) * certificate.nameLines;
    const inside = (x, y, width, height) => point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height;
    const target = inside(qr.x, qr.y, qr.size, qr.size) ? "qr" : inside(name.x, name.y, name.width, nameHeight) ? "name" : null;
    if (!target) return;
    const origin = target === "qr" ? qr : name;
    certificate.drag = { target, dx: point.x - origin.x, dy: point.y - origin.y };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  $("#certificate-canvas").addEventListener("pointermove", (event) => {
    if (!certificate.drag) return;
    const point = canvasPoint(event);
    const position = { x: point.x - certificate.drag.dx, y: point.y - certificate.drag.dy };
    if (certificate.drag.target === "qr") certificate.qrPos = position;
    else certificate.namePos = position;
    scheduleCertificatePreview();
  });
  ["pointerup", "pointercancel"].forEach((type) => $("#certificate-canvas").addEventListener(type, () => {
    if (!certificate.drag) return;
    // Keep the stored position inside the certificate.
    const { name, qr } = currentLayouts();
    certificate.namePos = { x: name.x, y: name.y };
    certificate.qrPos = { x: qr.x, y: qr.y };
    certificate.drag = null;
    scheduleCertificatePreview();
  }));
  $("#certificate-sample-pdf").addEventListener("click", async () => {
    const event = selectedCertificateEvent();
    if (!event) return;
    const feedback = $("#certificate-settings-feedback");
    try {
      const { spec } = await certificateSpec(event, {
        name: $("#certificate-sample-name").value.trim() || "Nama Relawan",
        number: $("#certificate-number").value.trim(),
        qrUrl: "https://kitabahagia.id/sertifikat?k=CONTOH",
      });
      const canvas = document.createElement("canvas");
      KBCertificate.render(canvas, spec);
      const url = URL.createObjectURL(await KBCertificate.toPdf(canvas));
      const link = document.createElement("a");
      link.href = url;
      link.download = `contoh-sertifikat-${event.slug}.pdf`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setFeedback(feedback, error.message, "error");
    }
  });
  $("#certificate-ornament-file").addEventListener("change", (event) => {
    void readCertificateUpload(event.currentTarget, "ornament", 1000, KBCertificate.HEIGHT, ["image/png"]);
  });
  $("#certificate-partner-logo").addEventListener("change", (event) => {
    void readCertificateUpload(event.currentTarget, "logo", 800, 800, ["image/png", "image/webp", "image/jpeg"]);
  });
  $("#certificate-partner-logo-remove").addEventListener("click", () => {
    certificate.uploadReads.logo += 1;
    certificate.logoUpload = null;
    certificate.removePartnerLogo = true;
    $("#certificate-partner-logo").value = "";
    scheduleCertificatePreview();
  });
  $("#certificate-settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const slug = $("#certificate-event").value;
    const feedback = $("#certificate-settings-feedback");
    if (!slug || certificate.pending || certificate.loadedSlug !== slug) return;
    const custom = $("#certificate-ornament").value === "custom";
    const canva = templateMode() === "canva";
    if (!canva && custom && !certificate.ornamentUpload && !certificate.settings?.ornament_url) {
      return setFeedback(feedback, "Pilih file ornamen khusus, atau pakai ornamen Kelopak/Balok.", "error");
    }
    if (canva && !certificate.templateUpload && !certificate.settings?.template_url) {
      return setFeedback(feedback, "Unggah desain dari Canva dulu.", "error");
    }
    const form = new FormData();
    const layouts = currentLayouts();
    form.append("template_mode", templateMode());
    form.append("name_layout", JSON.stringify(layouts.name));
    form.append("qr_layout", JSON.stringify(layouts.qr));
    if (certificate.templateUpload) {
      form.append("template", new File([certificate.templateUpload.blob], "template.jpg", { type: "image/jpeg" }));
    }
    form.append("certificate_number", $("#certificate-number").value.trim());
    form.append("description", $("#certificate-description").value.trim());
    form.append("ornament_preset", custom ? certificate.settings?.ornament_preset || "kelopak" : $("#certificate-ornament").value);
    form.append("ornament_color", $("#certificate-color").value);
    form.append("logo_variant", $("#certificate-logo").value);
    form.append("founder_id", $("#certificate-founder").value);
    form.append("project_leader_id", $("#certificate-leader").value);
    form.append("partner_signer_id", $("#certificate-partner").value);
    if (custom && certificate.ornamentUpload) {
      form.append("ornament", new File([certificate.ornamentUpload.blob], "ornament.png", { type: "image/png" }));
    } else if (!custom && certificate.settings?.ornament_url) {
      form.append("remove_ornament", "true");
    }
    if (certificate.logoUpload) {
      form.append("partner_logo", new File([certificate.logoUpload.blob], "partner-logo.png", { type: "image/png" }));
    } else if (certificate.removePartnerLogo) {
      form.append("remove_partner_logo", "true");
    }
    certificate.pending = true;
    syncCertificateForm();
    setFeedback(feedback, "Menyimpan pengaturan…");
    try {
      const url = new URL(adminCertificatesUrl);
      url.searchParams.set("event", slug);
      const data = await authorizedRequest(url, { method: "POST", body: form });
      // Apply only if the admin is still on this event (a newer load then becomes stale).
      if (slug === $("#certificate-event").value && certificate.loadedSlug === slug) {
        certificate.loadSeq += 1;
        signers = Array.isArray(data.signers) ? data.signers : signers;
        applyCertificateSettings(data.settings || null);
        renderSigners();
        void loadRecipients();
      }
      setFeedback(feedback, "Pengaturan sertifikat tersimpan.", "success");
    } catch (error) {
      setFeedback(feedback, error.message, "error");
    } finally {
      certificate.pending = false;
      scheduleCertificatePreview();
    }
  });

  // Sertifikat → issuing. Each certificate is drawn here with the saved settings, wrapped
  // in a PDF and uploaded; admin-certificate-issue owns the codes, the rules and the email.
  const issuance = { data: null, names: {}, running: false, loadSeq: 0, busyCode: "" };
  const issueUrl = (params) => {
    const url = new URL(adminCertificateIssueUrl);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    return url;
  };
  const issueJson = (params, body) => authorizedRequest(issueUrl(params), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

  // jsonb does not keep key order, so layouts are compared field by field.
  const sameLayout = (current, saved) => Boolean(saved)
    && Object.keys(current).every((key) => current[key] === saved[key]);

  // Issuing draws what the form shows, so the form must equal the saved settings.
  const certificateFormDirty = () => {
    const saved = certificate.settings;
    if (!saved) return true;
    const custom = $("#certificate-ornament").value === "custom";
    const layouts = currentLayouts();
    if (templateMode() !== (saved.template_mode || "system")) return true;
    if (templateMode() === "canva") {
      return ($("#certificate-number").value.trim() || null) !== (saved.certificate_number || null)
        || !sameLayout(layouts.name, saved.name_layout)
        || !sameLayout(layouts.qr, saved.qr_layout)
        || Boolean(certificate.templateUpload);
    }
    return ($("#certificate-number").value.trim() || null) !== (saved.certificate_number || null)
      || ($("#certificate-description").value.trim() || null) !== (saved.description || null)
      || custom !== Boolean(saved.ornament_url)
      || (!custom && ($("#certificate-ornament").value !== saved.ornament_preset || $("#certificate-color").value !== saved.ornament_color))
      || $("#certificate-logo").value !== saved.logo_variant
      || ($("#certificate-founder").value || null) !== (saved.founder_id || null)
      || ($("#certificate-leader").value || null) !== (saved.project_leader_id || null)
      || ($("#certificate-partner").value || null) !== (saved.partner_signer_id || null)
      || Boolean(certificate.ornamentUpload || certificate.logoUpload || certificate.removePartnerLogo);
  };

  const recipientName = (recipient) => issuance.names[recipient.registration_code]
    ?? recipient.certificate?.recipient_name ?? recipient.name;

  // "nadia putri LESTARI" → "Nadia Putri Lestari" (also after - and ').
  const tidyName = (name) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase("id-ID")
    .replace(/(^|[\s'-])(\p{L})/gu, (match, before, letter) => before + letter.toLocaleUpperCase("id-ID"));

  const renderRecipients = () => {
    const data = issuance.data;
    const section = $("#certificate-issue");
    section.hidden = !data;
    if (!data) return;
    const recipients = data.recipients || [];
    const issued = recipients.filter((recipient) => recipient.certificate?.issued_at);
    const pending = recipients.filter((recipient) => !recipient.certificate?.issued_at);
    const blocked = data.missing?.length ? `Lengkapi dulu di pengaturan: ${data.missing.join(", ")}.`
      : !data.open ? `Sertifikat bisa diterbitkan mulai ${formatDate(data.opens_on)} (H+${CERTIFICATE_AFTER_DAYS} setelah kegiatan).`
        : "";
    const state = $("#certificate-issue-state");
    state.textContent = blocked || (recipients.length ? "" : "Belum ada pendaftar yang ditandai hadir. Tandai hadir dulu di tab Pendaftar.");
    state.hidden = !state.textContent;
    $("#certificate-issue-toolbar").hidden = recipients.length === 0;
    const emailed = recipients.filter((recipient) => recipient.certificate?.email_sent_at).length;
    $("#certificate-issue-summary").textContent = `${issued.length}/${recipients.length} terbit · ${emailed} email terkirim${data.email_ready ? "" : " · email otomatis belum aktif"}`;
    const allButton = $("#certificate-issue-all");
    allButton.textContent = pending.length ? `Terbitkan ${pending.length} sertifikat` : "Semua sudah terbit";
    allButton.disabled = issuance.running || Boolean(blocked) || pending.length === 0;
    $("#certificate-tidy-names").disabled = issuance.running;
    $("#certificate-recipients").innerHTML = recipients.map((recipient) => {
      const cert = recipient.certificate;
      const code = recipient.registration_code;
      const busy = issuance.running || issuance.busyCode === code;
      const status = !cert?.issued_at ? "Belum terbit"
        : cert.email_sent_at ? `Terbit · email terkirim ${formatDateTime(cert.email_sent_at)}`
          : cert.email_error ? `Terbit · ${cert.email_error}` : "Terbit · email belum dikirim";
      const tone = !cert?.issued_at ? "" : cert.email_sent_at ? " is-positive" : " is-warning";
      const phone = normalizeWhatsApp(recipient.phone);
      const waText = cert?.issued_at ? `Halo ${recipientName(recipient)}, sertifikat relawan ${selectedCertificateEvent()?.title || ""} dari Kita Bahagia sudah terbit. Lihat dan unduh di sini: ${cert.url}` : "";
      return `
        <div class="certificate-recipient" data-recipient="${escapeHtml(code)}">
          <input type="text" maxlength="120" value="${escapeHtml(recipientName(recipient))}" aria-label="Nama di sertifikat untuk ${escapeHtml(recipient.name)}" data-recipient-name="${escapeHtml(code)}"${busy ? " disabled" : ""} />
          <span class="certificate-recipient-contact registration-sub">${escapeHtml(recipient.email || "-")} · ${escapeHtml(code)}</span>
          <span class="certificate-recipient-state${tone}">${escapeHtml(status)}</span>
          <div class="certificate-recipient-actions">
            ${cert?.issued_at ? `<a class="text-button" href="${escapeHtml(cert.url)}" target="_blank" rel="noopener">Lihat</a>` : ""}
            ${cert?.issued_at ? `<button class="text-button" type="button" data-reissue="${escapeHtml(code)}"${busy || blocked ? " disabled" : ""}>Terbitkan ulang</button>` : ""}
            ${cert?.issued_at && data.email_ready ? `<button class="text-button" type="button" data-resend="${escapeHtml(code)}"${busy ? " disabled" : ""}>${cert.email_sent_at ? "Kirim ulang email" : "Kirim email"}</button>` : ""}
            ${cert?.issued_at && phone ? `<a class="text-button" href="https://wa.me/${phone}?text=${encodeURIComponent(waText)}" target="_blank" rel="noopener noreferrer">WA</a>` : ""}
          </div>
        </div>`;
    }).join("");
  };

  const loadRecipients = async () => {
    const slug = $("#certificate-event").value;
    if (!slug) return;
    const seq = ++issuance.loadSeq;
    try {
      const data = await authorizedRequest(issueUrl({ event: slug }));
      if (seq !== issuance.loadSeq || slug !== $("#certificate-event").value) return;
      issuance.data = data;
      renderRecipients();
    } catch (error) {
      if (seq === issuance.loadSeq) setFeedback($("#certificate-issue-feedback"), error.message, "error");
    }
  };

  // One snapshot of the saved settings (fresh signed image URLs) for the whole run, so
  // editing the form or switching events mid-run cannot change what gets printed.
  const issueSnapshot = async (event) => {
    const url = new URL(adminCertificatesUrl);
    url.searchParams.set("event", event.slug);
    const data = await authorizedRequest(url);
    if (event.slug !== $("#certificate-event").value) throw new Error("Kegiatan berganti. Ulangi penerbitan.");
    signers = Array.isArray(data.signers) ? data.signers : signers;
    applyCertificateSettings(data.settings || null);
    certificate.loadedSlug = event.slug;
    const { images, spec } = await certificateSpec(event, { name: "", number: "", qrUrl: "" });
    const saved = data.settings || {};
    if (saved.template_mode === "canva") {
      if (!images.template) throw new Error("Desain Canva gagal dimuat. Periksa koneksi lalu coba lagi.");
      return spec;
    }
    const incomplete = images.columns.some((column) => column.name && !column.signature)
      || !images.logos.color || !images.logos.white
      || (saved.ornament_url && !images.ornament)
      || (saved.partner_signer_id && saved.partner_logo_url && !images.partnerLogo);
    if (incomplete) throw new Error("Gambar tanda tangan/logo/ornamen gagal dimuat. Periksa koneksi lalu coba lagi.");
    return spec;
  };

  // Resolves to { email } once the PDF is stored; an email problem never undoes the issue.
  const issueCertificate = async (event, baseSpec, recipient, sendEmail, beforeEmail) => {
    const name = recipientName(recipient).trim().replace(/\s+/g, " ");
    const slug = event.slug;
    const { certificate: issued } = await issueJson({ event: slug, action: "issue" },
      { registration_code: recipient.registration_code, recipient_name: name });
    const canvas = document.createElement("canvas");
    KBCertificate.render(canvas, { ...baseSpec, name, number: issued.certificate_number, qrUrl: issued.url });
    const pdf = await KBCertificate.toPdf(canvas);
    await authorizedRequest(issueUrl({ event: slug, action: "pdf", code: issued.verification_code, name, number: issued.certificate_number }), {
      method: "POST", headers: { "Content-Type": "application/pdf" }, body: pdf,
    });
    if (!sendEmail) return { email: null };
    await beforeEmail?.();
    try {
      const { email } = await issueJson({ event: slug, action: "email" }, { code: issued.verification_code });
      return { email };
    } catch (error) {
      return { email: { sent: false, error: error.message } };
    }
  };

  const runIssue = async (recipients) => {
    const event = selectedCertificateEvent();
    const feedback = $("#certificate-issue-feedback");
    if (!event || issuance.running || !recipients.length) return;
    if (certificateFormDirty()) return setFeedback(feedback, "Simpan pengaturan dulu. Sertifikat digambar dari pengaturan yang tersimpan.", "error");
    const badName = recipients.find((recipient) => recipientName(recipient).trim().length < 2);
    if (badName) return setFeedback(feedback, `Nama untuk ${badName.name} masih kosong.`, "error");
    issuance.running = true;
    renderRecipients();
    const failures = [];
    let done = 0;
    let emailProblems = 0;
    let stopped = "";
    try {
      setFeedback(feedback, "Menyiapkan tanda tangan dan pengaturan…");
      const baseSpec = await issueSnapshot(event);
      // Emails in a batch leave at least EMAIL_GAP_MS apart, so a new sending domain does not look
      // like a burst to Brevo/Gmail (12 at once sat in "Sent" without delivery, Oct 2026).
      const EMAIL_GAP_MS = 8000;
      let lastEmailAt = 0;
      for (const [index, recipient] of recipients.entries()) {
        const label = `${index + 1}/${recipients.length}: ${recipientName(recipient)}`;
        setFeedback(feedback, `Menerbitkan ${label}…`);
        const pace = async () => {
          const wait = lastEmailAt + EMAIL_GAP_MS - Date.now();
          if (wait > 0) {
            setFeedback(feedback, `Menerbitkan ${label} · email dikirim berjeda, jangan tutup halaman ini…`);
            await new Promise((resolve) => setTimeout(resolve, wait));
          }
          lastEmailAt = Date.now();
        };
        try {
          const { email } = await issueCertificate(event, baseSpec, recipient, issuance.data?.email_ready, pace);
          done += 1;
          if (email && !email.sent) emailProblems += 1;
        } catch (error) {
          failures.push(`${recipientName(recipient)}: ${error.message}`);
          // Rules that apply to everyone (settings, date) stop the whole run.
          if (["SETTINGS_INCOMPLETE", "TOO_EARLY", "SETTINGS_CHANGED"].includes(error.code)) {
            stopped = `${recipients.length - index - 1} lainnya belum diproses.`;
            break;
          }
        }
      }
    } catch (error) {
      stopped = error.message;
    } finally {
      issuance.running = false;
      home.checksAt = 0;
      await loadRecipients();
    }
    const message = [
      `${done} sertifikat terbit.`,
      emailProblems ? `${emailProblems} email belum terkirim (lihat status, bisa dikirim ulang atau lewat WA).` : "",
      failures.length ? `Gagal: ${failures.join("; ")}` : "",
      stopped,
    ].filter(Boolean).join(" ");
    // Unsent emails need follow-up, so that message stays on screen instead of a passing toast.
    setFeedback(feedback, message, failures.length || stopped ? "error" : emailProblems ? "warning" : "success");
  };

  $("#certificate-recipients").addEventListener("input", (event) => {
    const input = event.target.closest("[data-recipient-name]");
    if (input) issuance.names[input.dataset.recipientName] = input.value;
  });
  $("#certificate-recipients").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-reissue], [data-resend]");
    if (!button || issuance.running) return;
    const code = button.dataset.reissue || button.dataset.resend;
    const recipient = issuance.data?.recipients.find((item) => item.registration_code === code);
    if (!recipient) return;
    if (button.dataset.reissue) return runIssue([recipient]);
    const feedback = $("#certificate-issue-feedback");
    issuance.busyCode = code;
    renderRecipients();
    try {
      const { email } = await issueJson({ event: $("#certificate-event").value, action: "email" }, { code: recipient.certificate.verification_code });
      setFeedback(feedback, email.sent ? `Email terkirim ke ${recipient.email}.` : email.error, email.sent ? "success" : "error");
    } catch (error) {
      setFeedback(feedback, error.message, "error");
    } finally {
      issuance.busyCode = "";
      await loadRecipients();
    }
  });
  $("#certificate-tidy-names").addEventListener("click", () => {
    // Only names not yet printed; issued ones change through "Terbitkan ulang".
    (issuance.data?.recipients || []).filter((recipient) => !recipient.certificate?.issued_at).forEach((recipient) => {
      issuance.names[recipient.registration_code] = tidyName(recipientName(recipient));
    });
    renderRecipients();
  });
  $("#certificate-issue-all").addEventListener("click", () => {
    void runIssue((issuance.data?.recipients || []).filter((recipient) => !recipient.certificate?.issued_at));
  });

  document.querySelectorAll("[data-admin-view]").forEach((link) => {
    link.addEventListener("click", async (event) => {
      event.preventDefault();
      const view = link.dataset.adminView;
      const alreadyVisible = (view === "home" && !homeView.hidden)
        || (view === "events" && !eventsView.hidden)
        || (view === "registrations" && !registrationsView.hidden)
        || (view === "stories" && !storiesView.hidden)
        || (view === "admins" && !adminsView.hidden)
        || (view === "certificates" && !certificatesView.hidden);
      if (alreadyVisible || !(await confirmLeaveForm())) return;
      if (view === "home") showHome();
      else if (view === "certificates") showCertificates();
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
      if ($("#invite-admin-role").value === "super_admin" && !(await confirmAction("Undangan ini memberi akses Super Admin.", { title: "Undang Super Admin?", confirmLabel: "Kirim undangan" }))) return;
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
    if (!(await confirmAction(`${selected.email} akan menjadi ${adminRoleLabels[role]}.`, { title: "Ubah peran?", confirmLabel: "Ubah peran" }))) {
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
    const deleteButton = event.target.closest("[data-delete-admin]");
    if (deleteButton) {
      const row = deleteButton.closest("[data-admin-id]");
      const selected = admins.find((admin) => admin.user_id === row?.dataset.adminId);
      if (!selected || !(await confirmAction(`${selected.email} dihapus permanen dari daftar admin dan tidak bisa masuk lagi. Riwayat "Diubah oleh" di kegiatan tetap ada.`, {
        title: "Hapus admin?", confirmLabel: "Hapus", danger: true,
      }))) return;
      deleteButton.disabled = true;
      setFeedback($("#admins-feedback"));
      try {
        await adminUsersRequest("PATCH", { action: "delete_admin", user_id: selected.user_id });
        admins = admins.filter((admin) => admin.user_id !== selected.user_id);
        invalidateAdminsCache();
        renderAdmins();
        setFeedback($("#admins-feedback"), `${selected.email} sudah dihapus.`, "success");
      } catch (error) {
        deleteButton.disabled = false;
        setFeedback($("#admins-feedback"), error.message, "error");
      }
      return;
    }
    const linkButton = event.target.closest("[data-generate-access-link]");
    if (linkButton) {
      const row = linkButton.closest("[data-admin-id]");
      const selected = admins.find((admin) => admin.user_id === row?.dataset.adminId);
      if (!selected || !(await confirmAction(`Tautan akses untuk ${selected.email} akan disalin. Kirim hanya ke orangnya langsung.`, { title: "Salin tautan akses?", confirmLabel: "Salin" }))) return;
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
      if (!selected || !(await confirmAction(`Email akses baru akan dikirim ke ${selected.email}.`, { title: "Kirim ulang akses?", confirmLabel: "Kirim" }))) return;
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
    if (!(await confirmAction(`Akses ${selected.email} akan ${nextActive ? "diaktifkan kembali" : "dinonaktifkan"}.`, { title: `${action[0].toUpperCase()}${action.slice(1)} akses?`, confirmLabel: `${action[0].toUpperCase()}${action.slice(1)}`, danger: action === "nonaktifkan" }))) return;
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
        await showHome();
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
      await showHome();
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
    if (riskyChange && !(await confirmAction(riskyChange, { title: "Simpan perubahan ini?", confirmLabel: "Simpan" }))) return;

    const button = $("#save-button");
    button.disabled = true;
    button.textContent = "Menyimpan…";
    setFeedback($("#form-feedback"));
    try {
      await adminRequest(originalSlug ? "PATCH" : "POST", originalSlug, payload);
      invalidateEventsCache();
      markDirty(eventForm, false);
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
      && !(await confirmAction("Kisah akan diterbitkan dan langsung tampil di website.", { title: "Terbitkan kisah?", confirmLabel: "Terbitkan" }))) return;

    const button = $("#save-story-button");
    button.disabled = true;
    button.textContent = "Menyimpan…";
    setFeedback($("#story-form-feedback"));
    try {
      await adminStoriesRequest(originalSlug ? "PATCH" : "POST", originalSlug, payload);
      invalidateStoriesCache();
      markDirty(storyForm, false);
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
    if (!(await confirmAction(message, { title: archived ? "Pulihkan kegiatan?" : "Arsipkan kegiatan?", confirmLabel: archived ? "Pulihkan" : "Arsipkan" }))) return;
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
    const confirmed = await confirmAction(`Kegiatan “${selected.title}” dan datanya dihapus permanen. Tindakan ini tidak bisa dibatalkan.`, {
      title: "Hapus permanen?", confirmLabel: "Hapus permanen", danger: true, requireText: selected.title,
    });
    if (!confirmed) return;
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
    if (!(await confirmAction(message, { title: archived ? "Pulihkan kisah?" : "Arsipkan kisah?", confirmLabel: archived ? "Pulihkan" : "Arsipkan" }))) return;
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
    const confirmed = await confirmAction(`Kisah “${selected.title}” dan datanya dihapus permanen. Tindakan ini tidak bisa dibatalkan.`, {
      title: "Hapus permanen?", confirmLabel: "Hapus permanen", danger: true, requireText: selected.title,
    });
    if (!confirmed) return;
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
    home.loadedAt = 0;
    home.checksAt = 0;
    currentRole = "";
    loginForm.reset();
    passwordSetupForm.reset();
    showLogin();
  };

  $("#add-event-button").addEventListener("click", () => showForm());
  $("#back-button").addEventListener("click", async () => { if (await confirmLeaveForm()) showEvents(); });
  $("#cancel-button").addEventListener("click", async () => { if (await confirmLeaveForm()) showEvents(); });
  $("#add-story-button").addEventListener("click", () => showStoryForm());
  $("#story-back-button").addEventListener("click", async () => { if (await confirmLeaveForm()) showStories(); });
  $("#story-cancel-button").addEventListener("click", async () => { if (await confirmLeaveForm()) showStories(); });
  $("#logout-button").addEventListener("click", logout);
  $("#mobile-logout-button").addEventListener("click", logout);

  (async () => {
    if (readAuthError() || readRecoverySession() || readInviteSession()) return;
    const token = await validAccessToken();
    if (!token) return showLogin();
    showAdmin();
    await showHome();
    prefetchAdminTabs();
  })();
})();
