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
    unpaid: "is-pending",
    pending: "is-pending",
    full: "is-neutral",
    closed: "is-neutral",
    completed: "is-neutral",
    draft: "is-neutral",
    cancelled: "is-negative",
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
    if (!response.ok) throw new Error(data.error?.message || "Permintaan belum dapat diproses.");
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
    eventFilter.innerHTML = `<option value="">Semua kegiatan</option>${events.map((event) =>
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

  const renderRegistrations = (total) => {
    $("#registrations-loading").hidden = true;
    $("#registrations-empty").hidden = registrations.length > 0;
    registrationsList.hidden = registrations.length === 0;
    $("#registrations-total").textContent = String(total);
    $(registrationLifecycle === "active" ? "#active-registrations-total" : "#history-registrations-total").textContent = String(total);
    registrationsList.innerHTML = registrations.map((registration) => {
      const linkedEvent = registration.events || {};
      const registrationStatus = registration.payment_expired ? "expired" : registration.registration_status;
      const paymentStatus = registration.payment_expired ? "expired" : registration.payment_status;
      return `
        <article class="registration-row">
          <div class="registration-person registration-cell">
            <span class="data-label">Pendaftar</span>
            <strong>${escapeHtml(registration.name)}</strong>
            <span>${escapeHtml(registration.email)}</span>
            <span>${escapeHtml(registration.phone)}</span>
            <span><span class="data-label">Domisili</span> ${escapeHtml(registration.domicile || "-")}</span>
            <span><span class="data-label">Asal instansi</span> ${escapeHtml(registration.institution || "-")}</span>
            <span><span class="data-label">DEFINISI BAHAGIA</span> ${escapeHtml(registration.reason || "-")}</span>${registration.selection_answer ? `
            <span><span class="data-label">JAWABAN SELEKSI</span> ${escapeHtml(registration.selection_answer)}</span>` : ""}
          </div>
          <div class="registration-event registration-cell">
            <span class="data-label">Kegiatan</span>
            <strong>${escapeHtml(linkedEvent.title || "Kegiatan tidak ditemukan")}</strong>
            <span class="registration-code"><span class="data-label">Kode</span>${escapeHtml(registration.registration_code)}</span>
          </div>
          <div class="registration-statuses">
            <span class="data-group"><span class="data-label">Pendaftaran</span><span class="status-token ${statusTone(registrationStatus)}">${escapeHtml(registrationStatusLabels[registrationStatus] || registrationStatus)}</span></span>
            <span class="data-group"><span class="data-label">Pembayaran</span><span class="status-token ${statusTone(paymentStatus)}">${escapeHtml(paymentStatusLabels[paymentStatus] || paymentStatus)}</span></span>
          </div>
          <span class="registration-date"><span class="data-label">Terdaftar</span><time datetime="${escapeHtml(registration.created_at)}">${escapeHtml(formatDateTime(registration.created_at))}</time>${registration.payment_expired && registration.payment_deadline ? `
            <span class="data-label">Batas bayar</span><time datetime="${escapeHtml(registration.payment_deadline)}">${escapeHtml(formatDateTime(registration.payment_deadline))}</time>` : ""}</span>
        </article>
      `;
    }).join("");
  };

  const loadRegistrations = async () => {
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
      renderRegistrations(cached.total);
      if (Date.now() - cached.loadedAt < adminCacheTtl) return;
    }
    if (tabCache.registrations.get(`${cacheKey}:request`)) return tabCache.registrations.get(`${cacheKey}:request`);
    $("#registrations-loading").hidden = Boolean(cached);
    if (!cached) {
      $("#registrations-empty").hidden = true;
      registrationsList.hidden = true;
      setFeedback($("#registrations-feedback"));
    }
    const request = registrationRequest(params)
      .then((data) => {
        registrations = Array.isArray(data.registrations) ? data.registrations : [];
        const total = Number(data.total) || 0;
        tabCache.registrations.set(cacheKey, { registrations, total, loadedAt: Date.now() });
        renderRegistrations(total);
        const otherLifecycle = registrationLifecycle === "active" ? "history" : "active";
        const otherParams = { ...params, lifecycle: otherLifecycle };
        return registrationRequest(otherParams).then((otherData) => {
          $(`#${otherLifecycle}-registrations-total`).textContent = String(Number(otherData.total) || 0);
        }).catch(() => undefined);
      })
      .catch((error) => {
        if (!cached) {
          $("#registrations-loading").hidden = true;
          setFeedback($("#registrations-feedback"), error.message, "error");
        }
      })
      .finally(() => tabCache.registrations.delete(`${cacheKey}:request`));
    tabCache.registrations.set(`${cacheKey}:request`, request);
    return request;
  };

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
    applicantsPerSeat: 4,
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
    toggleSelectionFields();
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

  document.querySelectorAll("[data-admin-view]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const view = link.dataset.adminView;
      const alreadyVisible = (view === "events" && !eventsView.hidden)
        || (view === "registrations" && !registrationsView.hidden)
        || (view === "stories" && !storiesView.hidden)
        || (view === "admins" && !adminsView.hidden);
      if (alreadyVisible) return;
      if (view === "registrations") showRegistrations();
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
