const SITE_CONFIG = {
  whatsappNumber: "6285282672806",
  whatsappMessage: "Halo Joy, saya tertarik ikut kegiatan. Boleh minta info lengkap?",
  whatsappChannelUrl: "https://whatsapp.com/channel/0029VapOA3D0lwgi1687Hq0X",
  instagramUrl: "https://instagram.com/kitabahagiaa_",
  tiktokUrl: "https://tiktok.com/@kita.bahagia_",
  emailAddress: "kitabahagiaidn@gmail.com",
  email: "https://mail.google.com/mail/?view=cm&fs=1&to=kitabahagiaidn@gmail.com&su=Halo%20Kita%20Bahagia,%20saya%20tertarik%20ikut%20kegiatan.%20Boleh%20info%20kegiatan%20terdekat?&body=&bcc=",
};

const SUPABASE_FUNCTIONS_BASE_URL = "https://cmrdapfuqtjlmpepfwfq.supabase.co/functions/v1";
// Demo events show on local development only; ?demo=1 / ?demo=0 override per visit.
const PUBLIC_EVENTS_CONFIG = Object.freeze({
  demo: (() => {
    const override = new URLSearchParams(window.location.search).get('demo');
    if (override === '1') return true;
    if (override === '0') return false;
    return ['localhost', '127.0.0.1'].includes(window.location.hostname);
  })()
});

const escapeHTML = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[character]));

const formatEventPrice = (price) => price === 0 ? 'Gratis' : new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0
}).format(price);

const fetchPublicEvents = async ({ slug = null, limit = null } = {}) => {
  const url = new URL(`${SUPABASE_FUNCTIONS_BASE_URL}/public-events`);
  if (PUBLIC_EVENTS_CONFIG.demo) url.searchParams.set('demo', 'true');
  if (slug) url.searchParams.set('slug', slug);
  if (limit !== null) url.searchParams.set('limit', String(limit));

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Public events request failed with status ${response.status}`);

  const payload = await response.json();
  if (!payload || !Array.isArray(payload.events)) throw new Error('Public events response is invalid');
  return payload.events;
};

const eventDateFormatter = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta'
});
const eventTimeFormatter = new Intl.DateTimeFormat('id-ID', {
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Jakarta'
});
const eventDateParts = (date) => Object.fromEntries(new Intl.DateTimeFormat('id-ID', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta'
}).formatToParts(date).map((part) => [part.type, part.value]));

const eventShortDateFormatter = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'Asia/Jakarta' });
const isSameEventDay = (a, b) => eventDateFormatter.format(a) === eventDateFormatter.format(b);
// Multi-day events name both days: "24 Okt, 09.00 – 25 Okt, 17.00 WIB".
const formatEventTime = (start, end) => {
  if (!end) return `${eventTimeFormatter.format(start)} WIB`;
  if (isSameEventDay(start, end)) return `${eventTimeFormatter.format(start)}\u2013${eventTimeFormatter.format(end)} WIB`;
  const day = (date) => eventShortDateFormatter.format(date).replace('.', '');
  return `${day(start)}, ${eventTimeFormatter.format(start)} \u2013 ${day(end)}, ${eventTimeFormatter.format(end)} WIB`;
};

const formatEventDeadline = (value) => {
  if (!value) return '';
  const deadline = new Date(value);
  if (Number.isNaN(deadline.getTime())) return '';
  return `${eventDateFormatter.format(deadline)}, ${eventTimeFormatter.format(deadline)} WIB`;
};

const formatEventDateRange = (start, end) => {
  if (!end) return eventDateFormatter.format(start);
  const startParts = eventDateParts(start);
  const endParts = eventDateParts(end);
  if (startParts.day === endParts.day && startParts.month === endParts.month && startParts.year === endParts.year) {
    return eventDateFormatter.format(start);
  }
  if (startParts.month === endParts.month && startParts.year === endParts.year) {
    return `${startParts.day}\u2013${endParts.day} ${endParts.month} ${endParts.year}`;
  }
  if (startParts.year === endParts.year) {
    return `${startParts.day} ${startParts.month}\u2013${endParts.day} ${endParts.month} ${endParts.year}`;
  }
  return `${eventDateFormatter.format(start)}\u2013${eventDateFormatter.format(end)}`;
};

const normalizeScheduleEvent = (event) => {
  const start = new Date(event.start_at);
  const end = event.end_at ? new Date(event.end_at) : null;
  if (!event.slug || !event.title || Number.isNaN(start.getTime()) || (end && Number.isNaN(end.getTime()))) return null;

  const remainingCapacity = event.remaining_capacity;
  const statusKey = remainingCapacity === 0 ? 'full' : String(event.status || '').toLowerCase();
  const statusLabels = {
    open: 'Pendaftaran dibuka',
    full: 'Kuota penuh',
    closed: 'Pendaftaran ditutup',
    completed: 'Selesai',
    cancelled: 'Dibatalkan'
  };
  const selection = event.registration_mode === 'selection';
  // Selection events show no numbers publicly (the API does not send them either).
  const capacity = selection
    ? 'Seleksi'
    : remainingCapacity === null
    ? 'Kuota tidak dibatasi'
    : remainingCapacity === 0
      ? 'Kuota penuh'
      : `${remainingCapacity} slot tersisa`;

  return {
    slug: event.slug,
    name: event.title,
    description: event.description || '',
    category: event.category || 'Tanpa kategori',
    categoryKey: event.category_key || 'uncategorized',
    start: event.start_at,
    end: event.end_at,
    date: formatEventDateRange(start, end),
    time: formatEventTime(start, end),
    location: event.location || 'Lokasi menyusul',
    status: statusLabels[statusKey] || event.status || 'Status belum tersedia',
    statusKey,
    capacity,
    remainingCapacity: event.remaining_capacity ?? null,
    price: Number(event.price) || 0,
    image: event.image_url || '',
    imageAlt: event.image_alt || `Dokumentasi ${event.title}`,
    registrationDeadline: event.registration_deadline || null,
    deadlineLabel: formatEventDeadline(event.registration_deadline),
    registrationMode: selection ? 'selection' : 'first_come',
    registrationOpensAt: event.registration_opens_at || null,
    applicantsFull: event.applicants_full === true,
    announcementAt: event.announcement_at || null,
    selectionQuestion: event.selection_question || '',
    selectionMinChars: Number(event.selection_min_chars) || 0,
    commitmentText: event.commitment_text || ''
  };
};

const normalizeRegistrationEvent = (event) => {
  const normalized = normalizeScheduleEvent(event);
  if (!normalized) return null;
  return {
    ...normalized,
    registrationDescription: event.registration_description || event.description || '',
    activities: Array.isArray(event.activities) ? event.activities.filter(Boolean) : [],
    benefits: Array.isArray(event.benefits) ? event.benefits.filter(Boolean) : [],
    selectionRequirements: Array.isArray(event.selection_requirements) ? event.selection_requirements.filter(Boolean) : [],
    remainingCapacity: event.remaining_capacity,
    registrationDeadline: event.registration_deadline || null,
    paymentWindowMinutes: Number.isInteger(event.payment_window_minutes) ? event.payment_window_minutes : null
  };
};

const eventRegistrationAvailability = (event) => {
  const availabilityEnd = new Date(event.end || event.start).getTime();
  if (event.statusKey === 'full') return { available: false, reason: 'full' };
  if (event.statusKey === 'closed') return { available: false, reason: 'closed' };
  if (event.statusKey === 'completed' || (!Number.isNaN(availabilityEnd) && availabilityEnd < Date.now())) {
    return { available: false, reason: 'past' };
  }
  if (Number.isNaN(availabilityEnd) || event.statusKey !== 'open') {
    return { available: false, reason: 'unavailable' };
  }
  if (event.applicantsFull) return { available: false, reason: 'applicants_full' };
  const opensAt = Date.parse(event.registrationOpensAt || '');
  if (Number.isFinite(opensAt) && opensAt > Date.now()) return { available: false, reason: 'not_yet', opensAt };
  return { available: true, reason: null };
};

const eventRegistrationLink = (event, className, eligibleLabel, unavailableLabel = 'Lihat detail') => `<a class="${className}"
  data-registration-link data-event-slug="${escapeHTML(event.slug)}"
  href="pendaftaran.html?event=${encodeURIComponent(event.slug)}">${eventRegistrationAvailability(event).available
    ? eligibleLabel : unavailableLabel}</a>`;

// Editorial event layouts shared by the schedule page and the homepage.
const eventCalendarFormatters = {
  day: new Intl.DateTimeFormat('id-ID', { day: 'numeric', timeZone: 'Asia/Jakarta' }),
  month: new Intl.DateTimeFormat('id-ID', { month: 'short', timeZone: 'Asia/Jakarta' }),
  weekday: new Intl.DateTimeFormat('id-ID', { weekday: 'long', timeZone: 'Asia/Jakarta' }),
  closing: new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', timeZone: 'Asia/Jakarta' }),
  monthYear: new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' }),
  isoDay: new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Jakarta' })
};
// Calendar-day number in Jakarta, so "N hari lagi" counts dates, not 24-hour blocks.
const jakartaDayNumber = (date) => {
  const [year, month, day] = eventCalendarFormatters.isoDay.format(date).split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 864e5;
};
const eventHref = (event) => `pendaftaran.html?event=${encodeURIComponent(event.slug)}`;
const eventClosingMarkup = (event) => {
  const deadline = new Date(event.registrationDeadline || '');
  if (Number.isNaN(deadline.getTime())) return '';
  const days = jakartaDayNumber(deadline) - jakartaDayNumber(new Date());
  const relative = days <= 0 ? 'Hari ini' : days === 1 ? 'Besok' : `${days} hari lagi`;
  return `<p class="event-closing">Tutup ${escapeHTML(eventCalendarFormatters.closing.format(deadline))} <b>${relative}</b></p>`;
};
const eventDateBlock = (event) => {
  const start = new Date(event.start);
  const end = event.end ? new Date(event.end) : null;
  const days = end && !Number.isNaN(end.getTime()) ? jakartaDayNumber(end) - jakartaDayNumber(start) + 1 : 1;
  return `<div class="event-date" aria-hidden="true"><b>${eventCalendarFormatters.day.format(start)}</b>
    <span>${escapeHTML(eventCalendarFormatters.month.format(start).replace('.', ''))}</span><small>${escapeHTML(eventCalendarFormatters.weekday.format(start))}${days > 1 ? ` · ${days} hari` : ''}</small></div>`;
};
// Few seats left is the "siapa cepat" signal, so it gets the accent.
const eventOpensFormatter = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta'
});
const eventSlotNote = (event) => {
  const availability = eventRegistrationAvailability(event);
  if (availability.reason === 'not_yet') {
    return `<span class="event-slot is-low">Dibuka ${escapeHTML(eventOpensFormatter.format(new Date(availability.opensAt)))}</span>`;
  }
  if (event.applicantsFull) return '<span class="event-slot is-full">Pendaftaran ditutup</span>';
  const remaining = event.remainingCapacity;
  if (event.statusKey === 'full' || remaining === 0) return '<span class="event-slot is-full">Kuota penuh</span>';
  if (Number.isInteger(remaining) && remaining <= 5 && eventRegistrationAvailability(event).available) {
    return `<span class="event-slot is-low">Tinggal ${remaining} slot</span>`;
  }
  return `<span class="event-slot">${escapeHTML(event.capacity)}</span>`;
};
const eventPhoto = (event, className) => `<figure class="${className}${event.image ? '' : ' is-empty'}">${event.image
  ? `<img src="${escapeHTML(event.image)}" alt="${escapeHTML(event.imageAlt)}" loading="lazy" decoding="async">` : ''}</figure>`;
const eventCta = (event) => {
  const { available } = eventRegistrationAvailability(event);
  return eventRegistrationLink(event, `event-cta${available ? '' : ' is-quiet'}`,
    'Daftar <span aria-hidden="true">&rarr;</span>', 'Lihat detail <span aria-hidden="true">&rarr;</span>');
};
const eventRowMarkup = (event, { heading = 'h2', attributes = '' } = {}) => `<article class="event-row"${attributes}>
  ${eventDateBlock(event)}
  ${eventPhoto(event, 'event-row-photo')}
  <div class="event-row-copy">
    <p class="event-kicker">${escapeHTML(event.category)}${event.statusKey === 'open' ? '' : ` <span>· ${escapeHTML(event.status)}</span>`}</p>
    <${heading} class="event-title"><a class="event-row-link" href="${eventHref(event)}">${escapeHTML(event.name)}</a></${heading}>
    <p class="event-where"><span class="visually-hidden">${escapeHTML(event.date)}, </span><span class="event-where-place">${escapeHTML(event.location)}</span><span class="event-where-sep"> · </span>${escapeHTML(event.time)}</p>
  </div>
  <div class="event-row-side"><strong class="event-price">${formatEventPrice(event.price)}</strong>${eventSlotNote(event)}${eventCta(event)}</div>
</article>`;
const eventFeatureMarkup = (event) => `<article class="event-feature">
  ${eventPhoto(event, 'event-feature-photo')}
  ${eventClosingMarkup(event)}
  <h3 class="event-title"><a class="event-row-link" href="${eventHref(event)}">${escapeHTML(event.name)}</a></h3>
  <p class="event-where">${escapeHTML(event.date)} · ${escapeHTML(event.location)}</p>
  ${event.description ? `<p class="event-summary-text">${escapeHTML(event.description)}</p>` : ''}
  <div class="event-feature-foot"><div><strong class="event-price">${formatEventPrice(event.price)}</strong>${eventSlotNote(event)}</div>${eventCta(event)}</div>
</article>`;

// Schedule rows grouped under a "Oktober 2026" heading; the count is kept in sync by the filters.
const eventMonthGroupsMarkup = (events, rowOptions) => {
  const groups = [];
  events.forEach((event) => {
    const label = eventCalendarFormatters.monthYear.format(new Date(event.start));
    if (groups.at(-1)?.label !== label) groups.push({ label, events: [] });
    groups.at(-1).events.push(event);
  });
  return groups.map(({ label, events: monthEvents }) => {
    const [month, year] = [label.replace(/\s*\d{4}$/, ''), (label.match(/\d{4}$/) || [''])[0]];
    return `<section class="event-month-group" aria-label="${escapeHTML(label)}">
      <h2 class="event-month"><span>${escapeHTML(month)}</span> <em>${escapeHTML(year)}</em> <small data-month-count>${monthEvents.length} kegiatan</small></h2>
      ${monthEvents.map((event) => eventRowMarkup(event, rowOptions(event))).join('')}
    </section>`;
  }).join('');
};

const skeletonLine = (size = '') => `<span class="loading-line${size ? ` loading-line-${size}` : ''}"></span>`;
const eventCardSkeleton = (className = 'schedule-card') => `<article class="${className} loading-card" aria-hidden="true">
  <div class="loading-media"></div>
  <div class="loading-card-copy">${skeletonLine('short')}${skeletonLine('title')}${skeletonLine('title-short')}
    <div class="loading-meta">${skeletonLine('meta')}${skeletonLine('meta')}${skeletonLine('meta-short')}</div>
  </div>
</article>`;

let homepageEventsLoading = false;
let scheduleEventsLoading = false;
const scheduleEmptyDefaultMarkup = document.getElementById('scheduleEmpty')?.innerHTML;

const renderHomepageEvents = async () => {
  const list = document.querySelector('[data-upcoming-list]');
  const empty = document.querySelector('[data-upcoming-empty]');
  if (!list || !empty) return;
  if (homepageEventsLoading) return;

  const setState = (title, message, retry = null) => {
    list.hidden = true;
    empty.querySelector('h3')?.replaceChildren(document.createTextNode(title));
    const messageContainer = empty.querySelector('div');
    const paragraph = messageContainer?.querySelector('p');
    paragraph?.replaceChildren(document.createTextNode(message));
    empty.querySelector('[data-event-retry]')?.remove();
    if (retry && messageContainer) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'kisah-state-action';
      button.dataset.eventRetry = '';
      button.textContent = 'Coba lagi';
      button.addEventListener('click', retry, { once: true });
      messageContainer.append(button);
    }
    empty.hidden = false;
  };

  homepageEventsLoading = true;
  list.innerHTML = `${eventCardSkeleton('event-row')}${eventCardSkeleton('event-row')}${eventCardSkeleton('event-row')}`;
  list.hidden = false;
  list.setAttribute('aria-busy', 'true');
  empty.hidden = true;

  let events;
  try {
    events = (await fetchPublicEvents({ limit: 3 }))
      .map(normalizeScheduleEvent)
      .filter(Boolean)
      .sort((a, b) => new Date(a.start) - new Date(b.start))
      .slice(0, 3);
  } catch (error) {
    console.error('Kegiatan terdekat gagal dimuat', error);
    list.removeAttribute('aria-busy');
    homepageEventsLoading = false;
    setState('Kegiatan belum dapat dimuat.', 'Periksa koneksi internet, lalu coba lagi.', renderHomepageEvents);
    return;
  }
  homepageEventsLoading = false;

  if (!events.length) {
    list.removeAttribute('aria-busy');
    setState('Belum ada kegiatan dalam waktu dekat.', 'Jadwal kegiatan berikutnya akan segera hadir. Pantau halaman jadwal untuk informasi terbaru.');
    return;
  }

  list.innerHTML = events.map((event) => eventRowMarkup(event, { heading: 'h3' })).join('');
  list.hidden = false;
  list.removeAttribute('aria-busy');
  empty.hidden = true;
};

const renderScheduleEvents = async () => {
  const grid = document.getElementById('scheduleGrid');
  const featuredSection = document.querySelector('[data-schedule-featured]');
  const featured = document.getElementById('scheduleFeatured');
  const empty = document.getElementById('scheduleEmpty');
  const count = document.getElementById('scheduleCount');
  if (!grid || !featuredSection || !featured) return;
  if (scheduleEventsLoading) return;

  const setMessage = (title, detail, retry = null) => {
    featuredSection.hidden = true;
    grid.replaceChildren();
    if (empty) {
      empty.replaceChildren();
      const heading = document.createElement('strong');
      const message = document.createElement('span');
      heading.textContent = title;
      message.textContent = detail;
      empty.append(heading, message);
      if (retry) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'kisah-state-action';
        button.dataset.eventRetry = '';
        button.textContent = 'Coba lagi';
        button.addEventListener('click', retry, { once: true });
        empty.append(button);
      }
      empty.classList.remove('hidden');
    }
  };

  scheduleEventsLoading = true;
  if (count) {
    count.textContent = 'Jadwal kegiatan sedang dimuat';
    count.classList.add('visually-hidden');
  }
  featuredSection.hidden = true;
  empty?.classList.add('hidden');
  grid.innerHTML = `${eventCardSkeleton('event-row')}${eventCardSkeleton('event-row')}${eventCardSkeleton('event-row')}`;
  grid.setAttribute('aria-busy', 'true');

  let scheduleEvents;
  try {
    scheduleEvents = (await fetchPublicEvents())
      .map(normalizeScheduleEvent)
      .filter(Boolean)
      .sort((a, b) => new Date(a.start) - new Date(b.start));
  } catch (error) {
    console.error('Jadwal kegiatan gagal dimuat', error);
    grid.removeAttribute('aria-busy');
    if (count) {
      count.classList.remove('visually-hidden');
      count.textContent = 'Jadwal gagal dimuat';
    }
    scheduleEventsLoading = false;
    setMessage('Jadwal belum dapat dimuat.', 'Periksa koneksi internet, lalu coba lagi.', renderScheduleEvents);
    return;
  }
  scheduleEventsLoading = false;

  if (!scheduleEvents.length) {
    grid.removeAttribute('aria-busy');
    if (count) {
      count.classList.remove('visually-hidden');
      count.textContent = 'Menampilkan 0 kegiatan';
    }
    setMessage('Belum ada kegiatan yang tersedia.', 'Silakan cek kembali untuk agenda berikutnya.');
    return;
  }

  const now = Date.now();
  const urgencyWindow = 14 * 24 * 60 * 60 * 1000;
  const urgentEvents = scheduleEvents.filter((event) => {
    if (!event.registrationDeadline || !eventRegistrationAvailability(event).available) return false;
    const remaining = new Date(event.registrationDeadline).getTime() - now;
    return remaining > 0 && remaining <= urgencyWindow;
  }).sort((a, b) => new Date(a.registrationDeadline) - new Date(b.registrationDeadline));

  if (urgentEvents.length) {
    featured.innerHTML = urgentEvents.map(eventFeatureMarkup).join('');
    featured.classList.toggle('is-single', urgentEvents.length === 1);
    featuredSection.hidden = false;
  } else {
    featured.replaceChildren();
    featuredSection.hidden = true;
  }

  grid.innerHTML = eventMonthGroupsMarkup(scheduleEvents, (event) => ({
    heading: 'h3',
    attributes: ` data-category="${escapeHTML(event.categoryKey)}" data-date="${escapeHTML(event.start)}" data-search="${escapeHTML(`${event.name} ${event.location} ${event.category}`.toLocaleLowerCase('id-ID'))}"`
  }));
  grid.removeAttribute('aria-busy');
  if (count) {
    count.classList.remove('visually-hidden');
    count.textContent = `Menampilkan ${scheduleEvents.length} kegiatan`;
  }
  empty?.classList.add('hidden');
  if (empty && scheduleEmptyDefaultMarkup !== undefined) empty.innerHTML = scheduleEmptyDefaultMarkup;

  const filterContainer = document.querySelector('.schedule-filters');
  const knownFilters = new Set([...document.querySelectorAll('[data-schedule-filter]')]
    .map((button) => button.dataset.scheduleFilter));
  scheduleEvents.forEach((event) => {
    if (!filterContainer || knownFilters.has(event.categoryKey)) return;
    const button = document.createElement('button');
    button.className = 'filter-btn';
    button.type = 'button';
    button.dataset.scheduleFilter = event.categoryKey;
    button.setAttribute('aria-pressed', 'false');
    button.textContent = event.category;
    filterContainer.append(button);
    knownFilters.add(event.categoryKey);
  });
  initializeScheduleFilters();
};

void renderHomepageEvents();
void renderScheduleEvents();

const REGISTRATION_CONFIG = Object.freeze({
  registrationEndpoint: `${SUPABASE_FUNCTIONS_BASE_URL}/create-registration`,
  paymentEndpoint: `${SUPABASE_FUNCTIONS_BASE_URL}/create-payment`,
  paymentStatusEndpoint: `${SUPABASE_FUNCTIONS_BASE_URL}/payment-status`
});

const setMobileMenuState = (shouldOpen) => {
  const nav = document.querySelector('.nav');
  const toggle = document.querySelector('.menu-toggle');
  const header = document.querySelector('.site-header');

  if (!nav || !toggle) return;

  nav.classList.toggle('open', shouldOpen);
  header?.classList.toggle('menu-open', shouldOpen);
  document.body.classList.toggle('mobile-menu-open', shouldOpen);
  toggle.setAttribute('aria-expanded', String(shouldOpen));
  toggle.setAttribute('aria-label', shouldOpen ? 'Tutup menu' : 'Buka menu');
};

const closeMobileMenu = () => setMobileMenuState(false);

document.querySelector('.menu-toggle')?.addEventListener('click', (event) => {
  const toggle = event.currentTarget;
  const nav = document.querySelector('.nav');

  if (!nav || !toggle) return;

  event.stopPropagation();
  const shouldOpen = !nav.classList.contains('open');
  setMobileMenuState(shouldOpen);
});

document.addEventListener('click', (event) => {
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.nav');

  if (!nav || !toggle || !nav.classList.contains('open')) return;

  const clickedToggle = toggle.contains(event.target);
  const clickedNav = nav.contains(event.target);

  if (!clickedToggle && !clickedNav) {
    closeMobileMenu();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeMobileMenu();
  }
});

window.addEventListener('resize', () => {
  if (window.innerWidth > 960) {
    closeMobileMenu();
  }
});

document.querySelectorAll('.nav a').forEach(link => link.addEventListener('click', () => {
  closeMobileMenu();
}));

const buildWhatsAppUrl = (linkEl) => {
  const isHomeOnlyChannel = linkEl.closest('.join-card') || linkEl.closest('.hero') || linkEl.closest('.hero-visual');
  const customUrl = (linkEl.dataset.wa || linkEl.dataset.whatsappLink || SITE_CONFIG.whatsappChannelUrl || '').trim();

  if (isHomeOnlyChannel && customUrl) return customUrl;

  return `https://wa.me/${SITE_CONFIG.whatsappNumber}?text=${encodeURIComponent(SITE_CONFIG.whatsappMessage)}`;
};

document.querySelectorAll('[data-wa]').forEach(link => {
  link.href = buildWhatsAppUrl(link);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
});
document.querySelectorAll('[data-instagram]').forEach(link => {
  link.href = SITE_CONFIG.instagramUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
});
document.querySelectorAll('[data-tiktok]').forEach(link => {
  link.href = SITE_CONFIG.tiktokUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
});

document.querySelectorAll('[data-email]').forEach(link => {
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.matchMedia('(max-width: 768px)').matches;
  const subject = encodeURIComponent('Halo Kita Bahagia, saya tertarik ikut kegiatan.');
  const body = encodeURIComponent('Halo Kita Bahagia,\n\nSaya tertarik ikut kegiatan. Boleh info kegiatan terdekat?\n\nTerima kasih.');

  link.href = isMobile
    ? `mailto:${SITE_CONFIG.emailAddress}?subject=${subject}&body=${body}`
    : SITE_CONFIG.email;

  link.target = isMobile ? '_self' : '_blank';
  link.rel = isMobile ? '' : 'noopener noreferrer';
});

document.querySelectorAll('.accordion-trigger').forEach(trigger => {
  const panel = trigger.closest('.accordion-item').querySelector('.accordion-panel');
  panel.id ||= `faq-${Array.from(document.querySelectorAll('.accordion-trigger')).indexOf(trigger)}`;
  trigger.setAttribute('aria-controls', panel.id);
  trigger.setAttribute('aria-expanded', String(trigger.closest('.accordion-item').classList.contains('open')));
  trigger.addEventListener('click', () => {
    const item = trigger.closest('.accordion-item');
    const wasOpen = item.classList.contains('open');
    document.querySelectorAll('.accordion-item').forEach(other => other.classList.remove('open'));
    if (!wasOpen) item.classList.add('open');
    document.querySelectorAll('.accordion-trigger').forEach(button => button.setAttribute('aria-expanded', String(button.closest('.accordion-item').classList.contains('open'))));
  });
});

const heroSlider = document.querySelector('[data-hero-slider]');
const heroSlides = Array.from(document.querySelectorAll('.hero-slide'));
const heroDots = Array.from(document.querySelectorAll('.hero-dot'));
const heroTrack = document.querySelector('.hero-campaign-track');

const homepageHeader = document.querySelector('.home-page .site-header');
const homepageHero = document.querySelector('.home-page .hero-campaign');
const desktopHeaderQuery = window.matchMedia('(min-width: 1024px)');

if (homepageHeader && homepageHero && 'IntersectionObserver' in window) {
  let headerObserver;

  const updateHomepageHeader = () => {
    headerObserver?.disconnect();
    homepageHeader.classList.remove('is-scrolled');

    const headerHeight = homepageHeader.getBoundingClientRect().height;
    headerObserver = new IntersectionObserver(([entry]) => {
      homepageHeader.classList.toggle('is-scrolled', !entry.isIntersecting);
    }, { rootMargin: `-${Math.round(headerHeight)}px 0px 0px 0px`, threshold: 0 });
    headerObserver.observe(homepageHero);
  };

  updateHomepageHeader();
  desktopHeaderQuery.addEventListener?.('change', updateHomepageHeader);
}

if (heroSlider && heroTrack && heroSlides.length) {
  let heroIndex = 0;
  let heroTimer = null;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchDeltaX = 0;
  const reduceHeroMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const updateHeroSlider = () => {
    heroSlides.forEach((slide, index) => {
      slide.classList.toggle('active', index === heroIndex);
    });

    heroDots.forEach((dot, index) => {
      dot.classList.toggle('active', index === heroIndex);
      dot.setAttribute('aria-pressed', String(index === heroIndex));
    });

    heroTrack.style.transform = `translateX(-${heroIndex * 100}%)`;
  };

  const startHeroAutoplay = () => {
    clearInterval(heroTimer);
    if (reduceHeroMotion.matches) return;

    heroTimer = setInterval(() => {
      heroIndex = (heroIndex + 1) % heroSlides.length;
      updateHeroSlider();
    }, 6000);
  };

  heroDots.forEach(dot => {
    dot.addEventListener('click', () => {
      heroIndex = Number(dot.dataset.index || 0);
      updateHeroSlider();
      startHeroAutoplay();
    });
  });

  heroTrack.addEventListener('touchstart', (event) => {
    const touch = event.changedTouches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    touchDeltaX = 0;
  }, { passive: true });

  heroTrack.addEventListener('touchmove', (event) => {
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStartX;
    const deltaY = touch.clientY - touchStartY;

    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      event.preventDefault();
      touchDeltaX = deltaX;
    }
  }, { passive: false });

  heroTrack.addEventListener('touchend', () => {
    if (Math.abs(touchDeltaX) < 50) return;

    heroIndex = touchDeltaX < 0
      ? (heroIndex + 1) % heroSlides.length
      : (heroIndex - 1 + heroSlides.length) % heroSlides.length;
    updateHeroSlider();
    startHeroAutoplay();
    touchDeltaX = 0;
  }, { passive: true });

  updateHeroSlider();
  startHeroAutoplay();
  heroSlider.addEventListener('focusin', () => clearInterval(heroTimer));
  heroSlider.addEventListener('focusout', startHeroAutoplay);
  reduceHeroMotion.addEventListener?.('change', startHeroAutoplay);
}

const testimonialSlides = Array.from(document.querySelectorAll('.testimonial-slide'));
const testimonialTrack = document.querySelector('.testimonial-track');
const testimonialSection = document.querySelector('.testimonial-section');
const prevTestimonialBtn = document.querySelector('.testimonial-arrow.prev');
const nextTestimonialBtn = document.querySelector('.testimonial-arrow.next');
const testimonialStatus = document.querySelector('[data-testimonial-status]');

if (testimonialSlides.length && testimonialTrack) {
  let activeIndex = 0;
  let testimonialTimer;
  let testimonialPointerHover = false;
  const testimonialMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const updateTestimonials = ({ announce = false } = {}) => {
    testimonialSlides.forEach((slide, index) => {
      const isActive = index === activeIndex;
      slide.classList.toggle('active', isActive);
      slide.setAttribute('aria-hidden', String(!isActive));
    });

    if (announce && testimonialStatus) {
      const activeSlide = testimonialSlides[activeIndex];
      const name = activeSlide.querySelector('.person strong')?.textContent?.trim() || '';
      const role = activeSlide.querySelector('.person span')?.textContent?.trim() || '';
      testimonialStatus.textContent = `Testimoni ${activeIndex + 1} dari ${testimonialSlides.length}: ${name}, ${role}.`;
    }
  };

  const stopTestimonialAutoplay = () => {
    clearInterval(testimonialTimer);
    testimonialTimer = undefined;
  };

  const startTestimonialAutoplay = ({ ignoreFocus = false } = {}) => {
    stopTestimonialAutoplay();
    if (
      testimonialMotion.matches
      || document.hidden
      || testimonialPointerHover
      || (!ignoreFocus && testimonialSection?.contains(document.activeElement))
    ) return;
    testimonialTimer = window.setInterval(() => {
      activeIndex = (activeIndex + 1) % testimonialSlides.length;
      updateTestimonials();
    }, 5000);
  };

  const navigateTestimonials = (direction, { ignoreFocus = false } = {}) => {
    activeIndex = (activeIndex + direction + testimonialSlides.length) % testimonialSlides.length;
    updateTestimonials({ announce: true });
    startTestimonialAutoplay({ ignoreFocus });
  };

  prevTestimonialBtn?.addEventListener('click', event => {
    navigateTestimonials(-1, { ignoreFocus: event.detail > 0 });
  });

  nextTestimonialBtn?.addEventListener('click', event => {
    navigateTestimonials(1, { ignoreFocus: event.detail > 0 });
  });

  testimonialSection?.addEventListener('pointerenter', event => {
    if (event.pointerType !== 'mouse') return;
    testimonialPointerHover = true;
    stopTestimonialAutoplay();
  });
  testimonialSection?.addEventListener('pointerleave', event => {
    if (event.pointerType !== 'mouse') return;
    testimonialPointerHover = false;
    startTestimonialAutoplay();
  });
  testimonialSection?.addEventListener('focusin', stopTestimonialAutoplay);
  testimonialSection?.addEventListener('focusout', event => {
    if (!testimonialSection.contains(event.relatedTarget)) startTestimonialAutoplay();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopTestimonialAutoplay();
    else startTestimonialAutoplay();
  });
  testimonialMotion.addEventListener?.('change', startTestimonialAutoplay);

  updateTestimonials();
  startTestimonialAutoplay();
}

document.getElementById('year')?.replaceChildren(document.createTextNode(new Date().getFullYear()));

const revealItems = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08 });
  revealItems.forEach(item => observer.observe(item));
} else revealItems.forEach(item => item.classList.add('visible'));

function initializeScheduleFilters() {
  const scheduleCards = [...document.querySelectorAll('[data-schedule-filter]')];
  const eventCards = [...document.querySelectorAll('[data-category]')];
  const scheduleCount = document.getElementById('scheduleCount');
  const scheduleEmpty = document.getElementById('scheduleEmpty');
  const scheduleSearch = document.getElementById('scheduleSearch');
  if (!scheduleCards.length || !eventCards.length) return;

  let activeFilter = 'all';
  const applyFilters = () => {
    const query = scheduleSearch?.value.trim().toLocaleLowerCase('id-ID') || '';
    let visible = 0;
    eventCards.forEach((card) => {
      const categoryMatches = activeFilter === 'all' || card.dataset.category === activeFilter;
      const searchMatches = !query || card.dataset.search?.includes(query);
      const match = categoryMatches && searchMatches;
      card.classList.toggle('hidden', !match);
      if (match) visible += 1;
    });
    document.querySelectorAll('.event-month-group').forEach((group) => {
      const inGroup = group.querySelectorAll('[data-category]:not(.hidden)').length;
      group.classList.toggle('hidden', inGroup === 0);
      const label = group.querySelector('[data-month-count]');
      if (label) label.textContent = `${inGroup} kegiatan`;
    });
    if (scheduleCount) scheduleCount.textContent = `Menampilkan ${visible} kegiatan`;
    scheduleEmpty?.classList.toggle('hidden', visible !== 0);
  };

  scheduleCards.forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.scheduleFilter;
      scheduleCards.forEach((item) => {
        item.classList.remove("active");
        item.setAttribute("aria-pressed", String(item === button));
      });
      button.classList.add("active");
      applyFilters();
    });
  });
  scheduleSearch?.addEventListener('input', applyFilters);
}

function initScheduleCountdown() {
  const timer = document.getElementById("countdown");
  if (!timer) return;

  const events = [...document.querySelectorAll("[data-category]")]
    .map((card) => ({
      name: card.querySelector("h2")?.textContent?.trim() || "Kegiatan Kita Bahagia",
      date: new Date(card.dataset.date),
      meta: card.querySelector(".schedule-meta")?.textContent?.replace(/\s+/g, " ").trim() || ""
    }))
    .filter((event) => !Number.isNaN(event.date.getTime()) && event.date.getTime() > Date.now())
    .sort((a, b) => a.date - b.date);

  const nextEvent = events[0];
  if (!nextEvent) {
    timer.innerHTML = "<div class=\"countdown-message\"><strong>Belum ada agenda terdekat</strong><span>Silakan cek kembali jadwal berikutnya.</span></div>";
    return;
  }

  const nameEl = document.getElementById("nextEventName");
  const metaEl = document.getElementById("nextEventMeta");
  if (nameEl) nameEl.textContent = nextEvent.name;
  if (metaEl) metaEl.textContent = nextEvent.meta;

  const update = () => {
    const diff = nextEvent.date.getTime() - Date.now();
    if (diff <= 0) {
      timer.innerHTML = "<div class=\"countdown-message\"><strong>Kegiatan sedang berlangsung 🎉</strong><span>Semoga harinya berjalan menyenangkan.</span></div>";
      return;
    }
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff / 3600000) % 24);
    const minutes = Math.floor((diff / 60000) % 60);
    const seconds = Math.floor((diff / 1000) % 60);
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = String(value).padStart(2, "0"); };
    set("cdDays", days); set("cdHours", hours); set("cdMinutes", minutes); set("cdSeconds", seconds);
  };
  update();
  setInterval(update, 1000);
}

initScheduleCountdown();

const safeWhatsAppGroupUrl = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && url.hostname === 'chat.whatsapp.com' ? url.toString() : null;
  } catch {
    return null;
  }
};

const announcementDateFormatter = new Intl.DateTimeFormat('id-ID', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta'
});
// Heading and message for a registration's current state, shared by the
// registration page and cek-status.html. payment-status already hides selection
// results before the announcement date, so 'applied' covers that wait.
const registrationOutcomeCopy = (data) => {
  const selection = data?.registration_mode === 'selection';
  const title = data?.event_title || 'kegiatan ini';
  const announcement = Date.parse(data?.announcement_at || '');
  switch (data?.registration_status) {
    case 'applied':
      return {
        heading: 'Pendaftaranmu sudah kami terima.',
        copy: `Tim Kita Bahagia akan menyeleksi semua pendaftar. ${Number.isFinite(announcement)
          ? `Hasilnya diumumkan ${announcementDateFormatter.format(new Date(announcement))}.`
          : 'Hasilnya akan diumumkan oleh tim.'} Simpan kode pendaftaranmu.`
      };
    case 'confirmed':
      return selection
        ? { heading: 'Selamat, kamu terpilih!', copy: `Kamu terpilih sebagai peserta ${title}.`, onboarding: true }
        : { heading: 'Kamu sudah terdaftar.', copy: 'Tempatmu sudah dikonfirmasi.', onboarding: true };
    case 'waitlisted':
      return {
        heading: 'Kamu masuk daftar cadangan.',
        copy: `Terima kasih sudah mendaftar ${title}. Kalau ada peserta yang berhalangan, tim Kita Bahagia akan menghubungimu lewat WhatsApp.`
      };
    case 'rejected':
      return {
        heading: 'Terima kasih sudah mendaftar.',
        copy: `Kali ini kamu belum terpilih sebagai peserta ${title} karena kuota terbatas. Sampai jumpa di kegiatan Kita Bahagia berikutnya.`
      };
    case 'pending_payment':
      return {
        heading: 'Pembayaran belum selesai.',
        copy: 'Lanjutkan pembayaran dari halaman kegiatan di perangkat yang sama, atau hubungi admin dengan kode pendaftaranmu.'
      };
    default:
      return {
        heading: 'Pendaftaran tidak aktif.',
        copy: 'Pendaftaran ini sudah dibatalkan atau batas pembayarannya sudah lewat.'
      };
  }
};

const registrationForm = document.querySelector('[data-registration-form]');

if (registrationForm) {
  const params = new URLSearchParams(window.location.search);
  const eventSlug = (params.get('event') || '').trim().toLowerCase();
  let selectedEvent = null;
  let registrationAvailable = false;
  const registrationContent = document.getElementById('registrationContent');
  const eventFallback = document.getElementById('eventFallback');
  const selectedEventIntro = document.getElementById('selectedEventIntro');
  const registrationProgress = document.getElementById('registrationProgress');
  const registrationFormPanel = document.getElementById('registrationFormPanel');
  const registrationReview = document.getElementById('registrationReview');
  const registrationUnavailable = document.getElementById('registrationUnavailable');
  const editRegistrationButton = document.getElementById('editRegistrationButton');
  const confirmRegistrationButton = document.getElementById('confirmRegistrationButton');
  const paymentStates = {
    pending: ['Selesaikan pembayaran', 'Slotmu ditahan sementara sampai batas waktu pembayaran. Jika pembayaran belum berhasil saat waktu habis, slot akan kembali tersedia untuk peserta lain.'],
    processing: ['Pembayaran sedang diverifikasi', 'Kami sedang memastikan pembayaranmu. Halaman ini akan diperbarui setelah statusnya terkonfirmasi.'],
    paid: ['Pembayaran berhasil', 'Tempatmu sudah dikonfirmasi.'],
    expired: ['Waktu pembayaran habis', 'QRIS sebelumnya sudah kedaluwarsa. Pendaftaranmu masih tersimpan. Kamu bisa membuat QRIS baru untuk melanjutkan pembayaran.'],
    failed: ['Pembayaran belum berhasil', 'Pembayaran tidak berhasil diselesaikan. Pendaftaranmu tetap tercatat.'],
    refunded: ['Pembayaran dikembalikan', 'Pembayaran ini sudah dikembalikan. Hubungi tim Kita Bahagia bila perlu bantuan.'],
    deadline_passed: ['Waktu pembayaran habis, pendaftaran dibatalkan', 'Batas waktu pembayaran sudah lewat, jadi kuota untuk pendaftaran ini sudah dilepas. Kamu bisa mendaftar lagi jika kuota masih tersedia.']
  };
  const paymentStatusCopy = {
    pending: ['Menunggu pembayaran', 'Slotmu ditahan sementara sampai batas waktu pembayaran. Jika pembayaran belum berhasil saat waktu habis, slot akan kembali tersedia untuk peserta lain.'],
    processing: ['Pembayaran sedang diperiksa', 'Pembayaranmu sedang diperiksa. Tidak perlu melakukan pembayaran ulang.'],
    refunded: ['Pembayaran dikembalikan', 'Pembayaran ini sudah dikembalikan.']
  };
  const requestedDemo = ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? params.get('payment_demo') : null;
  const paymentDemoStates = ['pending', 'processing', 'paid', 'expired', 'failed'];
  const paymentDemo = paymentDemoStates.includes(requestedDemo) ? requestedDemo : null;
  // Set by the pending-payment "Kembali ke detail kegiatan" link: show the event
  // without auto-resuming payment, while keeping the stored recovery intact.
  let detailViewRequested = params.get('view') === 'detail';
  const recoveryStorageKey = `kb:registration-recovery:v1:${eventSlug}`;
  const terminalRecoveryRefreshKey = `kb:registration-terminal-refresh:v1:${eventSlug}`;

  let countdownTimer = null;
  let paymentPollTimer = null;
  let qrRenewTimer = null;
  let qrRenewalActive = false;
  let qrRenewalRetryAt = 0;
  let lateSettlementTimer = null;
  let paymentPollStopped = false;
  let paymentPollActive = false;
  let paymentStatusRequest = null;
  let manualPaymentCheckActive = false;
  // Last known payment attempt; status responses lack qr_url/amount, so renders merge onto this.
  let activePayment = null;
  let lastRenderedPaymentState = null;
  let paymentCheckNoteTimer = null;
  // In-memory copy of the recovery contact so the status check still works when storage is blocked or cleared.
  let paymentContact = null;

  const hidePaymentCheckNote = () => {
    window.clearTimeout(paymentCheckNoteTimer);
    const note = document.querySelector('#paymentStage [data-payment-check-note]');
    if (note) {
      note.hidden = true;
      note.textContent = '';
    }
  };

  const showPaymentCheckNote = (message) => {
    const note = document.querySelector('#paymentStage [data-payment-check-note]');
    if (!note) return;
    window.clearTimeout(paymentCheckNoteTimer);
    note.textContent = message;
    note.hidden = false;
    paymentCheckNoteTimer = window.setTimeout(hidePaymentCheckNote, 8000);
  };

  const clearTerminalRecoveryRefreshMarker = () => {
    try {
      window.sessionStorage.removeItem(terminalRecoveryRefreshKey);
    } catch {
      // Session storage is optional; a fresh registration remains available.
    }
  };

  const markTerminalRecoveryForRefresh = (registration) => {
    const code = String(registration?.registration_code || '').trim().toUpperCase();
    if (!code) return;
    try {
      window.sessionStorage.setItem(terminalRecoveryRefreshKey, code);
    } catch {
      // Immediate success recovery is best-effort when session storage is unavailable.
    }
  };

  const isDocumentReload = () => {
    try {
      const navigation = window.performance?.getEntriesByType('navigation')?.[0];
      return navigation?.type === 'reload';
    } catch {
      return false;
    }
  };

  const hasTerminalRecoveryRefreshMarker = (recovery) => {
    try {
      return window.sessionStorage.getItem(terminalRecoveryRefreshKey) === recovery.registration_code;
    } catch {
      return false;
    }
  };

  const canRestoreTerminalRecovery = (recovery) => isDocumentReload()
    && hasTerminalRecoveryRefreshMarker(recovery);

  const readRegistrationRecovery = () => {
    try {
      const value = JSON.parse(localStorage.getItem(recoveryStorageKey) || 'null');
      const valid = value?.event_slug === eventSlug
        && /^KB-[A-Z0-9-]{6,40}$/.test(value.registration_code)
        && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email);
      if (valid) {
        paymentContact = { registration_code: value.registration_code, email: value.email };
        return value;
      }
      localStorage.removeItem(recoveryStorageKey);
    } catch {
      try {
        localStorage.removeItem(recoveryStorageKey);
      } catch {
        // Storage can be unavailable; the registration form remains usable.
      }
      return null;
    }
    return null;
  };

  const persistRegistrationRecovery = (registration, email) => {
    clearTerminalRecoveryRefreshMarker();
    paymentContact = {
      registration_code: String(registration.registration_code || '').trim().toUpperCase(),
      email: String(email || '').trim().toLowerCase()
    };
    try {
      localStorage.setItem(recoveryStorageKey, JSON.stringify({
        event_slug: eventSlug,
        registration_code: String(registration.registration_code || '').trim().toUpperCase(),
        email: String(email || '').trim().toLowerCase()
      }));
    } catch {
      // Recovery is best-effort when browser storage is unavailable.
    }
  };

  // The deadline screen is shown once per registration (plus refreshes); later
  // visits start a fresh registration instead of repeating it.
  const markRecoveryDeadlineShown = () => {
    try {
      const value = JSON.parse(localStorage.getItem(recoveryStorageKey) || 'null');
      if (value && !value.deadline_shown) localStorage.setItem(recoveryStorageKey, JSON.stringify({ ...value, deadline_shown: true }));
    } catch {
      // Best-effort; without storage the screen is simply shown again.
    }
  };

  const clearRegistrationRecovery = () => {
    paymentContact = null;
    clearTerminalRecoveryRefreshMarker();
    try {
      localStorage.removeItem(recoveryStorageKey);
    } catch {
      // Storage can be unavailable without blocking a fresh registration.
    }
  };

  const setRegistrationStep = (step) => {
    const order = ['data', 'confirmation', 'payment'];
    const activeIndex = order.indexOf(step);
    registrationProgress?.classList.remove('hidden');
    registrationProgress?.querySelectorAll('[data-registration-step]').forEach((item, index) => {
      item.classList.toggle('is-active', index === activeIndex);
      item.classList.toggle('is-complete', activeIndex >= 0 && index < activeIndex);
      if (index === activeIndex) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
    const paymentStepLabel = registrationProgress?.querySelector('[data-registration-step="payment"] strong');
    if (paymentStepLabel && selectedEvent) paymentStepLabel.textContent = selectedEvent.price > 0 ? 'Pembayaran' : 'Selesai';
  };

  const focusRegistrationStep = (target) => {
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start'
    });
  };

  const setDataText = (selector, value, root = document) => {
    const element = root.querySelector(selector);
    if (element) element.textContent = value;
  };

  const stopPaymentMonitoring = () => {
    window.clearInterval(countdownTimer);
    window.clearTimeout(paymentPollTimer);
    window.clearTimeout(qrRenewTimer);
    qrRenewTimer = null;
    window.clearTimeout(lateSettlementTimer);
    lateSettlementTimer = null;
    countdownTimer = null;
    paymentPollTimer = null;
    paymentPollStopped = true;
    paymentPollActive = false;
  };

  // payment_deadline is the registration's whole payment window; expires_at is one QRIS.
  const paymentDeadlineTime = (data) => Date.parse(data?.payment_deadline || '');
  const paymentDeadlinePassed = (data) => {
    const deadline = paymentDeadlineTime(data);
    return Number.isFinite(deadline) && deadline <= Date.now();
  };

  const formatPaymentCountdown = (milliseconds) => {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return hours ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const updatePaymentCountdown = (expiresAt, onExpired) => {
    const countdown = document.querySelector('#paymentStage .payment-countdown');
    const countdownValue = countdown?.querySelector('strong');
    const expiry = new Date(expiresAt).getTime();
    if (!countdown || !countdownValue || Number.isNaN(expiry)) return;
    countdown.hidden = false;
    const deadlineLabel = countdown.querySelector('small');
    if (deadlineLabel) deadlineLabel.textContent = new Intl.DateTimeFormat('id-ID', {
      weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta'
    }).format(new Date(expiry)) + ' WIB';
    const update = () => {
      const remaining = expiry - Date.now();
      countdownValue.textContent = formatPaymentCountdown(remaining);
      if (remaining <= 0) {
        window.clearInterval(countdownTimer);
        countdownTimer = null;
        onExpired();
      }
    };
    window.clearInterval(countdownTimer);
    update();
    if (expiry > Date.now()) countdownTimer = window.setInterval(update, 1000);
  };

  // QRIS payload from Midtrans, drawn as our own QR instead of the Midtrans poster image.
  const validQrString = (value) => typeof value === 'string' && /^000201[\x20-\x7E]{14,1018}$/.test(value);
  // The payload only counts for the QR image it arrived with, so a renewed QR never shows a stale code.
  const qrStringFor = (data) => (data?.qr_payload?.url === data?.qr_url ? data.qr_payload.value : null);
  const buildQr = (value) => {
    if (typeof window.qrcode !== 'function' || !validQrString(value)) return null;
    try {
      const qr = window.qrcode(0, 'M');
      qr.addData(value, 'Byte');
      qr.make();
      return qr;
    } catch {
      return null;
    }
  };
  const QR_QUIET_ZONE = 4;
  const qrSvgMarkup = (qr) => {
    const count = qr.getModuleCount();
    const size = count + QR_QUIET_ZONE * 2;
    let path = '';
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (qr.isDark(row, col)) path += `M${col + QR_QUIET_ZONE} ${row + QR_QUIET_ZONE}h1v1h-1z`;
      }
    }
    return `<svg viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" aria-hidden="true"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#231f20"/></svg>`;
  };

  const renderPaymentState = (state, incoming) => {
    const stage = document.getElementById('paymentStage');
    if (!stage || !Object.hasOwn(paymentStates, state)) return;
    const sameRegistration = activePayment?.registration_code === incoming?.registration_code;
    const data = { ...(sameRegistration ? activePayment : {}) };
    Object.entries(incoming || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') data[key] = value;
    });
    activePayment = data;
    const stateChanged = stage.hidden || lastRenderedPaymentState !== state;
    lastRenderedPaymentState = state;
    hidePaymentCheckNote();
    const downloadNote = stage.querySelector('[data-payment-download-note]');
    if (downloadNote) {
      downloadNote.hidden = true;
      downloadNote.textContent = '';
    }
    if (['paid', 'expired', 'failed', 'refunded', 'deadline_passed'].includes(state)) stopPaymentMonitoring();
    if (['expired', 'failed', 'deadline_passed'].includes(state)) markTerminalRecoveryForRefresh(data);
    const [heading, body] = paymentStates[state];
    eventFallback?.classList.add('hidden');
    Object.keys(paymentStates).forEach((key) => stage.classList.toggle(`payment_${key}`, key === state));
    stage.classList.remove('is-recovery-error');
    stage.querySelectorAll('[data-payment-state]').forEach((container) => {
      const statusCopy = paymentStatusCopy[state];
      container.hidden = container.dataset.paymentState !== `payment_${state}` || !statusCopy;
      if (!container.hidden) {
        container.querySelector('strong').textContent = statusCopy[0];
        let paragraph = container.querySelector('p');
        if (!paragraph) {
          paragraph = document.createElement('p');
          container.append(paragraph);
        }
        paragraph.textContent = statusCopy[1];
      }
    });
    stage.querySelector('[data-result-code]').textContent = data.registration_code;
    stage.querySelector('[data-result-title]').textContent = data.event_title;
    stage.querySelector('[data-payment-amount]').textContent = typeof data.amount === 'number' ? formatEventPrice(data.amount) : 'Tidak tersedia';
    stage.querySelector('#paymentHeading').textContent = heading;
    stage.querySelector('.payment-intro').textContent = body;
    stage.querySelector('.payment-details dl > div:last-child dd').textContent = state === 'paid'
      ? 'Pendaftaran kegiatan · pembayaran dikonfirmasi' : `Pendaftaran kegiatan · ${heading.toLowerCase()}`;
    const qr = stage.querySelector('.payment-qr-placeholder');
    const qrImage = qr?.querySelector('[data-payment-qr]');
    const hasQr = typeof data.qr_url === 'string' && /^https:\/\//.test(data.qr_url);
    qr.hidden = !hasQr || !['pending', 'processing'].includes(state);
    const qrCode = qr?.querySelector('[data-payment-qr-code]');
    const drawnQr = hasQr ? buildQr(qrStringFor(data)) : null;
    if (qrCode) {
      qrCode.hidden = !drawnQr;
      qrCode.innerHTML = drawnQr ? qrSvgMarkup(drawnQr) : '';
    }
    const downloadButton = stage.querySelector('[data-payment-download]');
    if (downloadButton) downloadButton.hidden = qr.hidden;
    const checkButton = stage.querySelector('[data-payment-check]');
    if (checkButton) checkButton.hidden = !['pending', 'processing'].includes(state);
    const qrLabel = `QRIS pembayaran ${formatEventPrice(data.amount)} untuk ${data.event_title || selectedEvent?.name || 'kegiatan Kita Bahagia'}`;
    if (qrImage) {
      qrImage.hidden = Boolean(drawnQr) || !hasQr;
      if (hasQr && !drawnQr) {
        qrImage.src = data.qr_url;
        qrImage.alt = qrLabel;
      }
    }
    if (qrCode && drawnQr) qrCode.setAttribute('aria-label', qrLabel);
    qr.setAttribute('aria-label', hasQr ? 'QRIS pembayaran' : 'QRIS belum tersedia');
    const retryPaymentButton = stage.querySelector('[data-payment-retry]');
    if (retryPaymentButton) {
      retryPaymentButton.hidden = !['expired', 'failed'].includes(state);
      retryPaymentButton.disabled = false;
      retryPaymentButton.textContent = 'Buat QRIS baru';
    }
    const retryError = stage.querySelector('[data-payment-retry-error]');
    if (retryError) {
      retryError.hidden = true;
      retryError.textContent = '';
    }
    const instagramCta = stage.querySelector('[data-payment-instagram-cta]');
    if (instagramCta) instagramCta.hidden = state !== 'paid';
    const backLink = stage.querySelector('[data-payment-back]');
    if (backLink) {
      backLink.hidden = !['pending', 'expired'].includes(state) || !eventSlug;
      if (eventSlug) backLink.href = `pendaftaran.html?event=${encodeURIComponent(eventSlug)}&view=detail`;
    }
    stage.querySelector('.payment-countdown').hidden = state !== 'pending' || !(data.payment_deadline || data.expires_at);
    // Next steps sit right under the message, so nobody has to scroll back up for them.
    const scheduleLink = stage.querySelector('[data-payment-schedule]');
    if (scheduleLink) scheduleLink.hidden = true;
    const nextActions = stage.querySelector('[data-payment-next]');
    if (nextActions) nextActions.hidden = state !== 'deadline_passed';
    const registerAgain = stage.querySelector('[data-payment-register-again]');
    if (registerAgain) {
      registerAgain.hidden = !eventSlug;
      if (eventSlug) registerAgain.href = `pendaftaran.html?event=${encodeURIComponent(eventSlug)}`;
    }
    if (state === 'deadline_passed') markRecoveryDeadlineShown();
    stage.querySelector('.payment-guide').hidden = !['pending', 'processing'].includes(state);
    stage.querySelector('.payment-recovery-error').hidden = true;
    stage.querySelector('.payment-amount').hidden = !['pending', 'processing', 'expired', 'failed'].includes(state);
    stage.querySelector('.payment-primary').hidden = false;
    stage.querySelector('.payment-details').hidden = false;
    if (paymentDemo && state === 'pending') {
      stage.querySelector('#paymentHeading').textContent = 'Simulasi pembayaran';
      stage.querySelector('.payment-primary > p').textContent = 'Pendaftaran demo tercatat. Gunakan tombol simulasi di bawah untuk mencoba hasil pembayaran berhasil. Tidak ada uang yang ditagih.';
      stage.querySelector('[data-payment-state="payment_pending"] strong').textContent = 'Menunggu simulasi';
      stage.querySelector('[data-payment-state="payment_pending"] p').textContent = 'Ini bukan tagihan atau reservasi kegiatan sungguhan.';
    }
    document.getElementById('freeRegistrationConfirmation').hidden = true;
    registrationContent?.classList.add('hidden');
    setRegistrationStep('payment');
    const orderRow = stage.querySelector('[data-result-order]');
    if (orderRow) orderRow.textContent = data.order_id || 'Menunggu dibuat';
    stage.hidden = false;
    // A new state can be much shorter than the last one (QR -> result), so bring the card's top into view.
    if (stateChanged) focusRegistrationStep(stage);
    else stage.focus({ preventScroll: true });
    if (state === 'deadline_passed') scheduleLateSettlementChecks(data);
    if (state === 'pending') {
      // Count down to the registration deadline; a QRIS that lapses earlier is renewed automatically.
      if (data.payment_deadline) {
        updatePaymentCountdown(data.payment_deadline, () => handlePaymentDeadlineReached(activePayment));
        scheduleQrRenewal(data);
      } else if (data.expires_at) {
        updatePaymentCountdown(data.expires_at, () => renderPaymentState('expired', { ...data, payment_status: 'expired' }));
      }
    }
  };

  const renderOnboarding = (container, data) => {
    if (!container) return;
    const copy = container.querySelector('[data-onboarding-copy]');
    const link = container.querySelector('[data-whatsapp-group]');
    const groupUrl = safeWhatsAppGroupUrl(data?.whatsapp_group_url);
    container.hidden = false;
    if (!groupUrl) {
      if (copy) copy.textContent = 'Link grup akan tersedia setelah disiapkan oleh tim Kita Bahagia.';
      if (link) {
        link.hidden = true;
        link.removeAttribute('href');
      }
      return;
    }
    if (copy) copy.textContent = 'Gabung ke grup kegiatan untuk menerima informasi dan koordinasi dari tim Kita Bahagia.';
    if (link) {
      link.href = groupUrl;
      link.hidden = false;
    }
  };

  const fetchRegistrationStatus = async (registration, email) => {
    if (paymentStatusRequest) return paymentStatusRequest;
    paymentStatusRequest = fetch(REGISTRATION_CONFIG.paymentStatusEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ registration_code: registration.registration_code, email }),
      signal: AbortSignal.timeout(10000)
    }).then(async (response) => ({ response, result: await response.json().catch(() => null) }))
      .then(({ response, result }) => {
        if (!response.ok || !result?.payment_status) throw { code: result?.error?.code || 'STATUS_ERROR' };
        return result;
      }).finally(() => { paymentStatusRequest = null; });
    return paymentStatusRequest;
  };

  const createPayment = async (registration, recoveryEmail = '') => {
    const email = String(recoveryEmail || new FormData(registrationForm).get('email') || '').trim().toLowerCase();
    const response = await fetch(REGISTRATION_CONFIG.paymentEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ registration_code: registration.registration_code, email }),
      signal: AbortSignal.timeout(20000)
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.registration_code || result.payment_status !== 'pending'
      || typeof result.amount !== 'number' || typeof result.qr_url !== 'string' || typeof result.expires_at !== 'string') {
      throw { code: result?.error?.code || 'PAYMENT_ERROR' };
    }
    return {
      ...registration, ...result,
      qr_payload: { url: result.qr_url, value: validQrString(result.qr_string) ? result.qr_string : null },
      event_title: registration.event_title || selectedEvent.name
    };
  };

  const showConfirmedRegistration = (data) => {
    stopPaymentMonitoring();
    renderPaymentState('paid', data);
    renderOnboarding(document.querySelector('#paymentStage [data-registration-onboarding]'), data);
    markTerminalRecoveryForRefresh(data);
    document.getElementById('paymentStage')?.focus();
  };

  const showFreeRegistrationConfirmation = (data) => {
    const resultStage = document.getElementById('freeRegistrationConfirmation');
    if (!resultStage) return;
    document.getElementById('paymentStage').hidden = true;
    registrationContent?.classList.add('hidden');
    registrationProgress?.classList.add('hidden');
    resultStage.querySelector('[data-result-code]').textContent = data.registration_code;
    resultStage.querySelector('[data-result-title]').textContent = data.event_title || selectedEvent?.name || '';
    // Selection applications reuse this screen: waiting, accepted, waitlisted or not selected.
    const outcome = registrationOutcomeCopy({
      registration_mode: selectedEvent?.registrationMode,
      announcement_at: selectedEvent?.announcementAt,
      event_title: data.event_title || selectedEvent?.name,
      ...data
    });
    resultStage.querySelector('#freeConfirmationHeading').textContent = outcome.heading;
    resultStage.querySelector('[data-confirmation-copy]').textContent = outcome.copy;
    const instagramCta = resultStage.querySelector('[data-registration-instagram-cta]');
    if (instagramCta) instagramCta.hidden = isSelectionEvent();
    const onboarding = resultStage.querySelector('[data-registration-onboarding]');
    if (outcome.onboarding) renderOnboarding(onboarding, data);
    else onboarding.hidden = true;
    const statusLink = resultStage.querySelector('[data-status-link]');
    if (statusLink) {
      statusLink.hidden = !isSelectionEvent();
      statusLink.querySelector('a').href = `cek-status.html?kode=${encodeURIComponent(data.registration_code)}`;
    }
    resultStage.hidden = false;
    document.getElementById('registrationStatus')?.classList.add('hidden');
    markTerminalRecoveryForRefresh(data);
    resultStage.focus();
  };

  // Shared by polling and the manual check: renders terminal outcomes, returns false while still pending.
  const applyPaymentStatusResult = (result, base) => {
    if (result.payment_status === 'paid' && result.registration_status === 'confirmed') {
      showConfirmedRegistration({ ...base, ...result });
      return true;
    }
    if (result.registration_status === 'pending_payment' && paymentDeadlinePassed({ ...base, ...result })) {
      renderPaymentState('deadline_passed', { ...base, ...result });
      return true;
    }
    if (result.payment_status === 'expired' && Number.isFinite(paymentDeadlineTime({ ...base, ...result }))) {
      // Back off after a refused renewal so polling does not call create-payment every 5 seconds.
      if (Date.now() < qrRenewalRetryAt) return false;
      void renewExpiredQr({ ...base, ...result });
      return true;
    }
    if (['expired', 'failed', 'refunded'].includes(result.payment_status)) {
      renderPaymentState(result.payment_status, { ...base, ...result });
      return true;
    }
    return false;
  };

  const paymentContactFor = (data) => readRegistrationRecovery()
    || (paymentContact?.email && paymentContact.registration_code === data?.registration_code ? paymentContact : null);

  // A QRIS expired while the payment window is still open: create the next one for the same registration.
  const renewExpiredQr = async (data) => {
    if (qrRenewalActive) return;
    if (paymentDeadlinePassed(data)) {
      void handlePaymentDeadlineReached(data);
      return;
    }
    const contact = paymentContactFor(data);
    if (!contact) {
      renderPaymentState('expired', { ...data, payment_status: 'expired' });
      return;
    }
    qrRenewalActive = true;
    try {
      const payment = await createPayment({ ...data, registration_code: contact.registration_code }, contact.email);
      renderPaymentState('pending', payment);
      pollPaymentStatus(payment, contact.email);
    } catch (error) {
      qrRenewalRetryAt = Date.now() + 60000;
      if (error?.code === 'PAYMENT_DEADLINE_PASSED') {
        void handlePaymentDeadlineReached(data);
      } else if (['PAYMENT_IN_PROGRESS', 'PAYMENT_AWAITING_CONFIRMATION', 'PAYMENT_ALREADY_PAID'].includes(error?.code)) {
        renderPaymentState('processing', data);
        pollPaymentStatus(data, contact.email);
      } else {
        renderPaymentState('expired', { ...data, payment_status: 'expired' });
      }
    } finally {
      qrRenewalActive = false;
    }
  };

  const scheduleQrRenewal = (data) => {
    window.clearTimeout(qrRenewTimer);
    const qrExpiry = Date.parse(data?.expires_at || '');
    const deadline = paymentDeadlineTime(data);
    if (!Number.isFinite(qrExpiry) || !Number.isFinite(deadline) || qrExpiry >= deadline) return;
    qrRenewTimer = window.setTimeout(() => renewExpiredQr(activePayment), Math.max(0, qrExpiry - Date.now()) + 1000);
  };

  // Check once more before closing, so a payment that settled at the last second is still confirmed.
  const handlePaymentDeadlineReached = async (data) => {
    window.clearTimeout(qrRenewTimer);
    const contact = paymentContactFor(data);
    if (contact) {
      try {
        const result = await fetchRegistrationStatus(contact, contact.email);
        if (applyPaymentStatusResult(result, data)) return;
      } catch {
        // Fall through: the deadline itself is known locally.
      }
    }
    renderPaymentState('deadline_passed', data);
  };

  // The webhook still confirms a payment made just before the deadline, so check
  // a few more times after showing the deadline screen (not an open-ended poll).
  const scheduleLateSettlementChecks = (data) => {
    const contact = paymentContactFor(data);
    if (!contact) return;
    const delays = [15000, 45000, 120000];
    const next = () => {
      const delay = delays.shift();
      if (delay === undefined) return;
      lateSettlementTimer = window.setTimeout(async () => {
        try {
          const result = await fetchRegistrationStatus(contact, contact.email);
          if (result.payment_status === 'paid' && result.registration_status === 'confirmed') {
            showConfirmedRegistration({ ...data, ...result });
            return;
          }
        } catch {
          // Try again at the next delay.
        }
        next();
      }, delay);
    };
    next();
  };

  const pollPaymentStatus = (registration, email) => {
    paymentPollStopped = false;
    paymentPollActive = true;
    window.clearTimeout(paymentPollTimer);
    const poll = async () => {
      if (paymentPollStopped) return;
      try {
        const result = await fetchRegistrationStatus(registration, email);
        if (applyPaymentStatusResult(result, registration)) return;
      } catch {
        // A transient polling error should not interrupt the payment attempt.
      }
      if (!paymentPollStopped) paymentPollTimer = window.setTimeout(poll, 5000);
    };
    paymentPollTimer = window.setTimeout(poll, 5000);
  };

  window.addEventListener('pagehide', stopPaymentMonitoring, { once: true });

  const showEventFallback = (title, message, intro = title) => {
    registrationContent?.classList.add('hidden');
    registrationProgress?.classList.add('hidden');
    if (selectedEventIntro) selectedEventIntro.textContent = intro;
    selectedEventIntro?.classList.remove('loading-inline');
    selectedEventIntro?.removeAttribute('aria-hidden');
    if (eventFallback && !eventFallback.querySelector('h2')) {
      eventFallback.innerHTML = '<h2></h2><p></p><a class="text-link" href="jadwal.html">Lihat jadwal kegiatan &rarr;</a>';
    }
    const heading = eventFallback?.querySelector('h2');
    const paragraph = eventFallback?.querySelector('p');
    if (heading) heading.textContent = title;
    if (paragraph) paragraph.textContent = message;
    if (eventFallback) eventFallback.className = 'registration-fallback';
    eventFallback?.removeAttribute('aria-busy');
    eventFallback?.removeAttribute('aria-label');
  };

  const showEventSkeleton = () => {
    registrationContent?.classList.add('hidden');
    registrationProgress?.classList.add('hidden');
    if (selectedEventIntro) {
      selectedEventIntro.textContent = '';
      selectedEventIntro.classList.add('loading-inline');
      selectedEventIntro.setAttribute('aria-hidden', 'true');
    }
    if (!eventFallback) return;
    eventFallback.className = 'registration-loading';
    eventFallback.setAttribute('aria-busy', 'true');
    eventFallback.setAttribute('aria-label', 'Detail kegiatan sedang dimuat');
    eventFallback.innerHTML = `<div class="registration-loading-layout" aria-hidden="true">
      <div class="registration-loading-main"><div class="loading-media"></div><div class="registration-loading-copy">${skeletonLine('short')}${skeletonLine('title')}${skeletonLine()}${skeletonLine('long')}${skeletonLine('medium')}</div></div>
      <aside class="registration-loading-summary">${skeletonLine('short')}${skeletonLine('title')}${skeletonLine('title-short')}<div class="loading-meta">${skeletonLine('meta')}${skeletonLine('meta')}${skeletonLine('meta')}</div></aside>
    </div>`;
  };

  const showRecoveryNotice = (title, message, retry = null) => {
    stopPaymentMonitoring();
    const paymentStage = document.getElementById('paymentStage');
    if (paymentStage) paymentStage.hidden = true;
    const freeConfirmation = document.getElementById('freeRegistrationConfirmation');
    if (freeConfirmation) freeConfirmation.hidden = true;
    registrationContent?.classList.add('hidden');
    registrationProgress?.classList.add('hidden');
    if (!eventFallback) return;
    eventFallback.className = 'registration-fallback';
    eventFallback.replaceChildren();
    const heading = document.createElement('h2');
    const paragraph = document.createElement('p');
    heading.textContent = title;
    paragraph.textContent = message;
    eventFallback.append(heading, paragraph);
    if (retry) {
      const button = document.createElement('button');
      button.className = 'btn btn-primary';
      button.type = 'button';
      button.textContent = 'Coba lagi';
      button.addEventListener('click', retry, { once: true });
      eventFallback.append(button);
    }
    eventFallback.removeAttribute('aria-busy');
    eventFallback.removeAttribute('aria-label');
  };

  const showPaymentRecoveryError = (registration, retry) => {
    const stage = document.getElementById('paymentStage');
    if (!stage) return;
    stopPaymentMonitoring();
    stage.classList.add('is-recovery-error');
    lastRenderedPaymentState = null;
    eventFallback?.classList.add('hidden');
    registrationContent?.classList.add('hidden');
    registrationProgress?.classList.add('hidden');
    stage.querySelectorAll('[data-payment-state]').forEach((item) => { item.hidden = true; });
    stage.querySelector('.payment-recovery-error').hidden = false;
    stage.querySelector('[data-payment-recovery-retry]').onclick = retry;
    stage.querySelector('#paymentHeading').textContent = 'Status pembayaran belum dapat diperiksa';
    stage.querySelector('.payment-intro').textContent = 'Data pendaftaranmu tetap tersimpan. Coba lagi untuk memeriksa status pembayaran.';
    stage.querySelector('.payment-amount').hidden = true;
    stage.querySelector('.payment-qr-placeholder').hidden = true;
    stage.querySelector('[data-payment-download]').hidden = true;
    stage.querySelector('[data-payment-check]').hidden = true;
    stage.querySelector('.payment-guide').hidden = true;
    stage.querySelector('[data-payment-retry]').hidden = true;
    stage.querySelector('.payment-countdown').hidden = true;
    const backLink = stage.querySelector('[data-payment-back]');
    backLink.hidden = !eventSlug;
    if (eventSlug) backLink.href = `pendaftaran.html?event=${encodeURIComponent(eventSlug)}&view=detail`;
    if (registration?.registration_code) stage.querySelector('[data-result-code]').textContent = registration.registration_code;
    stage.hidden = false;
    stage.focus();
  };

  // Event posters are dense with text, so the small ticket thumbnail opens the full poster.
  const posterDialog = document.getElementById('eventPosterDialog');
  document.querySelector('[data-poster-open]')?.addEventListener('click', () => {
    const source = document.getElementById('eventImage');
    const image = posterDialog?.querySelector('[data-poster-image]');
    if (!posterDialog || !image || !source?.getAttribute('src')) return;
    image.src = source.src;
    image.alt = source.alt;
    if (typeof posterDialog.showModal === 'function') posterDialog.showModal();
    else window.open(source.src, '_blank', 'noopener,noreferrer');
  });
  posterDialog?.querySelector('[data-poster-close]')?.addEventListener('click', () => posterDialog.close());
  // A click on the dimmed backdrop lands on the dialog element itself.
  posterDialog?.addEventListener('click', (event) => { if (event.target === posterDialog) posterDialog.close(); });

  let registrationOpensTimer = null;
  const registrationOpensFormatter = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta'
  });
  const formatOpensCountdown = (milliseconds) => {
    const totalSeconds = Math.ceil(milliseconds / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const clock = [Math.floor(totalSeconds % 86400 / 3600), Math.floor(totalSeconds % 3600 / 60), totalSeconds % 60]
      .map((part) => String(part).padStart(2, '0')).join(':');
    return days ? `${days} hari ${clock}` : clock;
  };
  const isSelectionEvent = () => selectedEvent?.registrationMode === 'selection';
  const isFreeSelectionEvent = () => isSelectionEvent() && Number(selectedEvent?.price) === 0;

  // Selection events add their own question and commitment checkbox to the form.
  const selectionAnswerInput = document.getElementById('selectionAnswer');
  const selectionCommitmentInput = document.getElementById('selectionCommitment');
  const instagramProofInput = document.getElementById('instagramProof');
  const INSTAGRAM_PROOF_MAX_BYTES = 2 * 1024 * 1024;
  const allowedProofTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  instagramProofInput?.addEventListener('change', () => {
    const error = document.getElementById('instagramProofError');
    const file = instagramProofInput.files?.[0];
    const message = file && !allowedProofTypes.has(file.type)
      ? 'Pilih screenshot JPG, PNG, atau WebP.' : '';
    instagramProofInput.setCustomValidity(message);
    instagramProofInput.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (error) {
      error.textContent = message;
      error.hidden = !message;
    }
  });
  // Optional CV/portfolio PDF. Not compressed; the server checks type, size and signature again.
  const selectionCvInput = document.getElementById('selectionCv');
  const CV_MAX_BYTES = 5 * 1024 * 1024;
  const cvFileError = (file) => {
    if (!file || !file.size) return '';
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) return 'Pilih file PDF.';
    return file.size > CV_MAX_BYTES ? 'Ukuran PDF maksimal 5 MB.' : '';
  };
  selectionCvInput?.addEventListener('change', () => {
    const message = cvFileError(selectionCvInput.files?.[0]);
    const error = document.getElementById('selectionCvError');
    selectionCvInput.setCustomValidity(message);
    selectionCvInput.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (error) {
      error.textContent = message;
      error.hidden = !message;
    }
  });
  const prepareCv = async (file) => {
    if (!(file instanceof File) || !file.size) return null;
    if (cvFileError(file)) throw { code: 'INVALID_CV' };
    const header = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    if (String.fromCharCode(...header) !== '%PDF-') throw { code: 'INVALID_CV' };
    // Some systems report an empty type for PDFs; the server requires application/pdf.
    return file.type === 'application/pdf' ? file : new File([file], file.name, { type: 'application/pdf' });
  };
  const prepareInstagramProof = async (file) => {
    if (!(file instanceof File) || !allowedProofTypes.has(file.type) || !file.size) {
      throw { code: 'INVALID_INSTAGRAM_PROOF' };
    }
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const jpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    const png = header.length >= 8 && header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e
      && header[3] === 0x47 && header[4] === 0x0d && header[5] === 0x0a && header[6] === 0x1a && header[7] === 0x0a;
    const webp = header.length >= 12 && String.fromCharCode(...header.subarray(0, 4)) === 'RIFF'
      && String.fromCharCode(...header.subarray(8, 12)) === 'WEBP';
    if (!(file.type === 'image/jpeg' && jpeg) && !(file.type === 'image/png' && png)
      && !(file.type === 'image/webp' && webp)) throw { code: 'INVALID_INSTAGRAM_PROOF' };

    if (typeof createImageBitmap !== 'function') {
      if (file.size <= INSTAGRAM_PROOF_MAX_BYTES) return file;
      throw { code: 'INVALID_INSTAGRAM_PROOF' };
    }
    let bitmap;
    try { bitmap = await createImageBitmap(file); }
    catch { throw { code: 'INVALID_INSTAGRAM_PROOF' }; }
    const maxDimension = 2000;
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= INSTAGRAM_PROOF_MAX_BYTES) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close();
      throw { code: 'INVALID_INSTAGRAM_PROOF' };
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const encode = (type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
    let blob = await encode('image/webp', 0.92);
    // Safari cannot encode WebP and returns PNG instead; fall back to JPEG like the admin uploader.
    if (!blob || blob.type !== 'image/webp') blob = await encode('image/jpeg', 0.9);
    if (!blob || !['image/webp', 'image/jpeg'].includes(blob.type) || blob.size > INSTAGRAM_PROOF_MAX_BYTES) {
      throw { code: 'INVALID_INSTAGRAM_PROOF' };
    }
    const extension = blob.type === 'image/webp' ? 'webp' : 'jpg';
    return new File([blob], `instagram-proof.${extension}`, { type: blob.type, lastModified: Date.now() });
  };
  const updateSelectionCounter = () => {
    const counter = document.getElementById('selectionAnswerCount');
    if (!counter || !selectionAnswerInput) return;
    // Code points, like the database's char_length (an emoji counts once).
    const length = [...selectionAnswerInput.value.replace(/\r\n?/g, '\n').trim()].length;
    const minimum = selectedEvent?.selectionMinChars || 0;
    counter.textContent = minimum
      ? (length >= minimum ? `${length} karakter · sudah cukup` : `${length} dari minimal ${minimum} karakter`)
      : `${length} karakter`;
    selectionAnswerInput.setCustomValidity(minimum && length < minimum
      ? `Jawaban minimal ${minimum} karakter (sekarang ${length}).` : '');
  };
  const renderSelectionFields = () => {
    const showQuestion = isSelectionEvent() && Boolean(selectedEvent.selectionQuestion);
    const showCommitment = isSelectionEvent() && Boolean(selectedEvent.commitmentText);
    const answerField = document.getElementById('selectionAnswerField');
    const commitmentField = document.getElementById('selectionCommitmentField');
    const proofField = document.getElementById('selectionInstagramProofField');
    if (proofField && instagramProofInput) {
      const showProof = isFreeSelectionEvent();
      proofField.hidden = !showProof;
      instagramProofInput.required = showProof;
      instagramProofInput.setCustomValidity('');
      instagramProofInput.removeAttribute('aria-invalid');
      const proofError = document.getElementById('instagramProofError');
      if (proofError) {
        proofError.textContent = '';
        proofError.hidden = true;
      }
      if (!showProof) instagramProofInput.value = '';
    }
    const cvField = document.getElementById('selectionCvField');
    const portfolioField = document.getElementById('selectionPortfolioField');
    if (cvField && portfolioField && selectionCvInput) {
      const showCv = isFreeSelectionEvent();
      cvField.hidden = !showCv;
      portfolioField.hidden = !showCv;
      selectionCvInput.setCustomValidity('');
      selectionCvInput.removeAttribute('aria-invalid');
      const cvError = document.getElementById('selectionCvError');
      if (cvError) {
        cvError.textContent = '';
        cvError.hidden = true;
      }
      if (!showCv) {
        selectionCvInput.value = '';
        document.getElementById('portfolioUrl').value = '';
      }
    }
    if (answerField && selectionAnswerInput) {
      answerField.hidden = !showQuestion;
      selectionAnswerInput.required = showQuestion;
      document.getElementById('selectionAnswerLabel').textContent = `${selectedEvent?.selectionQuestion || ''} *`;
      if (showQuestion) updateSelectionCounter();
      else selectionAnswerInput.setCustomValidity('');
    }
    if (commitmentField && selectionCommitmentInput) {
      commitmentField.hidden = !showCommitment;
      selectionCommitmentInput.required = showCommitment;
      document.getElementById('selectionCommitmentText').textContent = selectedEvent?.commitmentText || '';
    }
  };
  selectionAnswerInput?.addEventListener('input', updateSelectionCounter);

  const renderSelectedEvent = () => {
    if (!selectedEvent) return;
    const setText = (id, value) => {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    };

    if (selectedEventIntro) {
      selectedEventIntro.classList.remove('loading-inline');
      selectedEventIntro.removeAttribute('aria-hidden');
      selectedEventIntro.textContent = selectedEvent.name;
    }
    setText('eventName', selectedEvent.name);
    setText('eventCategory', selectedEvent.category);
    setText('eventDate', selectedEvent.date);
    setText('eventTime', selectedEvent.time);
    setText('eventLocation', selectedEvent.location);
    // The status line must not say "dibuka" while the form below is closed or not open yet.
    const statusReason = eventRegistrationAvailability(selectedEvent).reason;
    const statusText = statusReason === 'not_yet' ? 'Pendaftaran belum dibuka'
      : statusReason === 'applicants_full' ? 'Pendaftaran ditutup' : selectedEvent.status;
    setText('eventStatus', statusText === selectedEvent.capacity
      ? statusText
      : `${statusText} · ${selectedEvent.capacity}`);

    const eventImageWrap = document.getElementById('eventImageWrap');
    const eventImage = document.getElementById('eventImage');
    if (eventImageWrap && eventImage) {
      eventImageWrap.hidden = !selectedEvent.image;
      if (selectedEvent.image) {
        eventImage.src = selectedEvent.image;
        eventImage.alt = selectedEvent.imageAlt;
      } else {
        eventImage.removeAttribute('src');
        eventImage.alt = '';
      }
    }

    const descriptionSection = document.getElementById('eventDescriptionSection');
    const eventDescription = selectedEvent.registrationDescription || selectedEvent.description;
    setText('eventDescription', eventDescription || '');
    if (descriptionSection) descriptionSection.hidden = !eventDescription;
    document.querySelector('.registration-content-nav a[href="#eventDescriptionSection"]')?.toggleAttribute('hidden', !eventDescription);

    // "**teks**" in an admin-written line becomes bold; everything stays text (no HTML).
    const appendEmphasis = (parent, text) => text.split(/\*\*(.+?)\*\*/).forEach((part, index) => {
      if (!part) return;
      if (index % 2 === 0) parent.append(part);
      else {
        const strong = document.createElement('strong');
        strong.textContent = part;
        parent.append(strong);
      }
    });
    const renderEventList = (sectionId, listId, navId, items, emphasis = false) => {
      const section = document.getElementById(sectionId);
      const list = document.getElementById(listId);
      const navLink = document.getElementById(navId);
      if (!section || !list) return;
      const entries = Array.isArray(items) ? items.filter(Boolean) : [];
      list.replaceChildren(...entries.map((item) => {
        const entry = document.createElement('li');
        if (emphasis) appendEmphasis(entry, item);
        else entry.textContent = item;
        return entry;
      }));
      section.hidden = entries.length === 0;
      if (navLink) navLink.hidden = entries.length === 0;
    };
    renderEventList('eventActivitiesSection', 'eventActivities', 'eventActivitiesNav', selectedEvent.activities);
    renderEventList('eventBenefitsSection', 'eventBenefits', 'eventBenefitsNav', selectedEvent.benefits);
    renderEventList('eventRequirementsSection', 'eventRequirements', 'eventRequirementsNav',
      isFreeSelectionEvent() ? selectedEvent.selectionRequirements : [], true);

    const eventNameInput = document.getElementById('kegiatan');
    const eventSlugInput = document.getElementById('eventSlug');
    if (eventNameInput) eventNameInput.value = selectedEvent.name;
    if (eventSlugInput) eventSlugInput.value = selectedEvent.slug;

    if (selectedEvent.price !== null && selectedEvent.price !== undefined) {
      setText('eventPrice', formatEventPrice(selectedEvent.price));
      document.getElementById('eventPriceRow')?.classList.remove('hidden');
    }

    const eventPrice = selectedEvent.price === null || selectedEvent.price === undefined
      ? 'Tidak tersedia' : formatEventPrice(selectedEvent.price);
    setDataText('[data-checkout-event-title]', selectedEvent.name);
    setDataText('[data-checkout-event-date]', `${selectedEvent.date} · ${selectedEvent.time}`);
    setDataText('[data-checkout-event-location]', selectedEvent.location);
    setDataText('[data-checkout-event-price]', eventPrice);

    const paymentWindowNote = document.getElementById('eventPaymentWindow');
    if (paymentWindowNote) {
      const minutes = selectedEvent.paymentWindowMinutes;
      const showWindow = selectedEvent.price > 0 && Number.isInteger(minutes) && minutes > 0;
      paymentWindowNote.hidden = !showWindow;
      if (showWindow) {
        const registrationClose = Date.parse(selectedEvent.registrationDeadline || '');
        if (Number.isFinite(registrationClose) && registrationClose < Date.now() + minutes * 60000) {
          // The server caps the hold at the registration deadline; say so instead of the full window.
          const closeLabel = new Intl.DateTimeFormat('id-ID', {
            day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta'
          }).format(new Date(registrationClose));
          paymentWindowNote.textContent = `Slotmu ditahan sementara sampai pendaftaran ditutup (${closeLabel} WIB). Jika pembayaran belum berhasil saat waktu habis, slot akan kembali tersedia untuk peserta lain.`;
        } else {
          const duration = minutes % 60 === 0 ? `${minutes / 60} jam` : `${minutes} menit`;
          paymentWindowNote.textContent = `Slotmu ditahan sementara sampai batas pembayaran, yaitu ${duration} setelah mendaftar. Jika pembayaran belum berhasil saat waktu habis, slot akan kembali tersedia untuk peserta lain.`;
        }
      }
    }

    eventFallback?.classList.add('hidden');
    eventFallback?.removeAttribute('aria-busy');
    registrationContent?.classList.remove('hidden');
    const submitButton = registrationForm.querySelector('[type="submit"]');
    const availabilityNote = document.getElementById('registrationAvailabilityNote');
    const availability = eventRegistrationAvailability(selectedEvent);
    registrationAvailable = Boolean(REGISTRATION_CONFIG.registrationEndpoint)
      && availability.available;
    document.querySelector('.registration-summary-cta')?.toggleAttribute('hidden', !registrationAvailable);
    registrationFormPanel?.classList.toggle('hidden', !registrationAvailable);
    registrationUnavailable?.classList.toggle('hidden', registrationAvailable);
    window.clearInterval(registrationOpensTimer);
    if (registrationAvailable) {
      setRegistrationStep('data');
    } else {
      registrationProgress?.classList.add('hidden');
      const unavailableCopy = {
        full: ['Kuota kegiatan telah terpenuhi', 'Seluruh tempat untuk kegiatan ini sudah terisi. Kamu masih dapat melihat detail kegiatan atau memilih agenda lainnya.'],
        closed: ['Pendaftaran telah ditutup', 'Waktu pendaftaran untuk kegiatan ini sudah berakhir. Kamu masih dapat melihat detail kegiatan atau memilih agenda lainnya.'],
        past: ['Kegiatan ini telah selesai', 'Kegiatan ini sudah berlangsung. Lihat detailnya atau temukan kegiatan lain yang masih tersedia.'],
        unavailable: ['Pendaftaran belum tersedia', 'Pendaftaran untuk kegiatan ini belum dapat dilakukan. Lihat detailnya atau pilih kegiatan lainnya.'],
        not_yet: ['Pendaftaran belum dibuka', ''],
        applicants_full: ['Pendaftaran sudah ditutup', 'Pendaftaran untuk kegiatan ini sudah ditutup. Pantau halaman jadwal untuk kegiatan berikutnya.']
      }[availability.reason || 'unavailable'];
      setText('registrationUnavailableTitle', unavailableCopy[0]);
      setText('registrationUnavailableMessage', unavailableCopy[1]);
      if (availability.reason === 'not_yet') {
        // Counts down to the opening time, then shows the form without a reload.
        const opensLabel = registrationOpensFormatter.format(new Date(availability.opensAt));
        const tick = () => {
          const left = availability.opensAt - Date.now();
          if (left <= 0) {
            window.clearInterval(registrationOpensTimer);
            renderSelectedEvent();
            return;
          }
          setText('registrationUnavailableMessage', `Pendaftaran dibuka ${opensLabel} WIB. Dibuka dalam ${formatOpensCountdown(left)}.`);
        };
        tick();
        registrationOpensTimer = window.setInterval(tick, 1000);
      }
    }
    renderSelectionFields();
    if (submitButton) {
      submitButton.disabled = !registrationAvailable;
      submitButton.textContent = 'Lanjutkan';
    }
    if (availabilityNote) {
      availabilityNote.textContent = registrationAvailable
        ? 'Kamu dapat memeriksa kembali data sebelum pendaftaran dikirim.'
        : 'Pendaftaran belum tersedia. Hubungi admin untuk informasi kegiatan berikutnya.';
    }
  };

  let registrationEventLoading = false;

  // Returning to registration from the detail view resumes the stored pending
  // registration instead of creating a new one.
  const resumePendingRegistration = async () => {
    detailViewRequested = false;
    const summaryCta = document.querySelector('.registration-summary-cta');
    if (summaryCta) summaryCta.textContent = 'Daftar kegiatan';
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('view');
      url.hash = '';
      window.history.replaceState(null, '', url);
    } catch {
      // Without history support a refresh simply shows the detail view again.
    }
    await recoverRegistration({ resumeFromDetail: true });
  };

  const showPendingRegistrationDetail = () => {
    registrationFormPanel?.classList.add('hidden');
    registrationUnavailable?.classList.add('hidden');
    registrationProgress?.classList.add('hidden');
    const summaryCta = document.querySelector('.registration-summary-cta');
    if (summaryCta) {
      summaryCta.hidden = false;
      summaryCta.textContent = 'Lanjutkan pembayaran';
    }
  };

  document.querySelector('.registration-summary-cta')?.addEventListener('click', (event) => {
    if (!detailViewRequested) return;
    event.preventDefault();
    void resumePendingRegistration();
  });

  const initializeRegistrationEvent = async () => {
    if (registrationEventLoading) return;
    if (!eventSlug) {
      showEventFallback(
        'Kegiatan tidak ditemukan',
        'Tautan pendaftaran ini tidak memuat kegiatan yang valid. Silakan kembali ke jadwal dan pilih kegiatan yang tersedia.',
        'Kegiatan belum dipilih'
      );
      return;
    }

    registrationEventLoading = true;
    showEventSkeleton();
    try {
      const events = await fetchPublicEvents({ slug: eventSlug });
      if (!events.length) {
        registrationEventLoading = false;
        showEventFallback(
          'Kegiatan tidak ditemukan',
          'Kegiatan ini tidak tersedia. Silakan kembali ke jadwal dan pilih kegiatan lain.'
        );
        return;
      }
      const event = normalizeRegistrationEvent(events[0]);
      if (!event || event.slug !== eventSlug) throw new Error('Public event response does not match requested slug');
      selectedEvent = event;
      renderSelectedEvent();
      if (detailViewRequested && readRegistrationRecovery()) {
        showPendingRegistrationDetail();
        return;
      }
      detailViewRequested = false;
      await recoverRegistration();
    } catch (error) {
      console.error('Detail kegiatan gagal dimuat', error);
      showRecoveryNotice(
        'Kegiatan belum dapat dimuat',
        'Periksa koneksi internet, lalu coba lagi.',
        initializeRegistrationEvent
      );
    } finally {
      registrationEventLoading = false;
    }
  };

  const showRegistrationMessage = (message, state = 'pending') => {
    const status = document.getElementById('registrationStatus');
    if (!status) return;
    status.textContent = message;
    status.className = `registration-message is-${state}`;
    status.focus();
  };

  const submitRegistration = async (form, slug) => {
    const formData = new FormData(form);
    const payload = {
      event_slug: slug,
      name: String(formData.get('nama') || '').trim(),
      phone: String(formData.get('telepon') || '').trim(),
      email: String(formData.get('email') || '').trim().toLowerCase(),
      domicile: String(formData.get('domicile') || '').trim(),
      institution: String(formData.get('institution') || '').trim(),
      reason: String(formData.get('alasan') || formData.get('bahagia') || '').trim(),
      notes: String(formData.get('catatan') || '').trim() || null,
      consent: formData.get('consent') !== null
    };
    // Only selection events send these, so first-come registrations stay compatible
    // with an older create-registration function during a staged deploy.
    if (isSelectionEvent()) {
      payload.selection_answer = String(formData.get('selection_answer') || '').trim() || null;
      payload.commitment = formData.get('selection_commitment') !== null;
    }
    let requestBody = JSON.stringify(payload);
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (isFreeSelectionEvent()) {
      payload.portfolio_url = String(formData.get('portfolio_url') || '').trim() || null;
      const proof = await prepareInstagramProof(formData.get('instagram_proof'));
      const cv = await prepareCv(formData.get('cv'));
      const multipart = new FormData();
      Object.entries(payload).forEach(([key, value]) => multipart.append(key, value === null ? '' : String(value)));
      multipart.append('instagram_proof', proof);
      if (cv) multipart.append('cv', cv);
      requestBody = multipart;
      delete headers['Content-Type'];
    }
    const response = await fetch(REGISTRATION_CONFIG.registrationEndpoint, {
      method: 'POST',
      headers,
      body: requestBody,
      signal: AbortSignal.timeout(20000)
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const code = result?.error?.code;
      throw { code: typeof code === 'string' ? code : 'SERVER_ERROR' };
    }
    if (!result?.success || !result.registration) throw { code: 'SERVER_ERROR' };
    return result.registration;
  };

  const registrationErrorMessages = {
    INVALID_CV: 'CV/portofolio harus berupa file PDF dengan ukuran maksimal 5 MB.',
    INVALID_PORTFOLIO_URL: 'Link portofolio harus diawali https:// dan maksimal 500 karakter.',
    FILES_TOO_LARGE: 'Ukuran file terlalu besar. Bukti follow maksimal 2 MB dan CV/portofolio maksimal 5 MB.',
    INVALID_INSTAGRAM_PROOF: 'Bukti follow wajib berupa screenshot JPG, PNG, atau WebP. Ukuran maksimal 2 MB setelah diperkecil.',
    INVALID_REQUEST: 'Data pendaftaran belum valid. Periksa kembali isian kamu.',
    EVENT_NOT_FOUND: 'Kegiatan ini belum ditemukan di sistem pendaftaran.',
    EVENT_NOT_OPEN: 'Pendaftaran untuk kegiatan ini sedang tidak dibuka.',
    REGISTRATION_CLOSED: 'Batas waktu pendaftaran kegiatan ini sudah berakhir.',
    EVENT_FULL: 'Kapasitas kegiatan ini sudah penuh.',
    ALREADY_REGISTERED: 'Email atau nomor WhatsApp ini sudah terdaftar di kegiatan ini. Jika belum membayar, lanjutkan pembayaran dari perangkat yang sama atau hubungi admin dengan kode pendaftaranmu.',
    REGISTRATION_NOT_OPEN: 'Pendaftaran kegiatan ini belum dibuka.',
    APPLICANTS_FULL: 'Pendaftaran kegiatan ini sudah ditutup.',
    INVALID_ANSWER: 'Jawaban seleksi belum memenuhi syarat. Periksa panjang jawaban dan centang pernyataan komitmen.',
    PAYMENT_IN_PROGRESS: 'Pembayaran sedang disiapkan. Status akan diperbarui otomatis.',
    PAYMENT_AWAITING_CONFIRMATION: 'Pembayaran sedang menunggu konfirmasi. Status akan diperbarui otomatis.',
    PAYMENT_ALREADY_PAID: 'Pembayaran untuk pendaftaran ini sudah selesai.',
    PAYMENT_PROVIDER_ERROR: 'Layanan pembayaran sedang bermasalah. Pendaftaranmu tetap tercatat.',
    PAYMENT_ERROR: 'QRIS belum dapat dibuat. Pendaftaranmu tetap tercatat. Silakan coba lagi beberapa saat lagi.',
    SERVER_ERROR: 'Layanan pendaftaran sedang bermasalah. Silakan coba lagi.'
  };

  let isSubmitting = false;
  let registrationCompleted = false;

  const recoveryPaymentData = (recovery, status = {}) => ({
    registration_code: recovery.registration_code,
    event_title: selectedEvent?.name || '',
    amount: selectedEvent?.price,
    ...status
  });

  // resumeFromDetail: the visitor pressed "Lanjutkan pembayaran" on ?view=detail, so a
  // registration that completed meanwhile is shown as confirmed instead of starting over.
  const recoverRegistration = async (options) => {
    const resumeFromDetail = options?.resumeFromDetail === true;
    const retryRecovery = () => recoverRegistration(options);
    const recovery = readRegistrationRecovery();
    if (!recovery) return false;
    if (hasTerminalRecoveryRefreshMarker(recovery) && !isDocumentReload()
      && !detailViewRequested && !resumeFromDetail) {
      clearRegistrationRecovery();
      renderSelectedEvent();
      return false;
    }
    showRecoveryNotice('Memeriksa pendaftaran', 'Kami sedang memulihkan status pendaftaranmu.');
    let status;
    try {
      status = await fetchRegistrationStatus(recovery, recovery.email);
    } catch (error) {
      if (['REGISTRATION_NOT_FOUND', 'INVALID_REQUEST'].includes(error?.code)) {
        clearRegistrationRecovery();
        renderSelectedEvent();
        showRegistrationMessage('Pendaftaran sebelumnya tidak ditemukan. Silakan isi kembali data peserta.', 'error');
        return false;
      }
      showPaymentRecoveryError(recovery, retryRecovery);
      return true;
    }

    const restored = recoveryPaymentData(recovery, status);
    if (status.registration_status === 'confirmed' && status.payment_status === 'paid') {
      if (!resumeFromDetail && !canRestoreTerminalRecovery(recovery)) {
        clearRegistrationRecovery();
        renderSelectedEvent();
        return false;
      }
      showConfirmedRegistration(restored);
      return true;
    }
    if (status.registration_status === 'confirmed' && status.payment_status === 'not_required') {
      if (!resumeFromDetail && !canRestoreTerminalRecovery(recovery)) {
        clearRegistrationRecovery();
        renderSelectedEvent();
        return false;
      }
      showFreeRegistrationConfirmation(restored);
      return true;
    }
    if (['applied', 'waitlisted', 'rejected'].includes(status.registration_status)) {
      if (!resumeFromDetail && !canRestoreTerminalRecovery(recovery)) {
        clearRegistrationRecovery();
        renderSelectedEvent();
        return false;
      }
      showFreeRegistrationConfirmation(restored);
      return true;
    }
    if (status.registration_status !== 'pending_payment') {
      clearRegistrationRecovery();
      renderSelectedEvent();
      showRegistrationMessage('Pendaftaran sebelumnya sudah tidak aktif. Kamu dapat mendaftar kembali.', 'error');
      return false;
    }
    if (paymentDeadlinePassed(status)) {
      if (recovery.deadline_shown && !resumeFromDetail && !canRestoreTerminalRecovery(recovery)) {
        clearRegistrationRecovery();
        renderSelectedEvent();
        return false;
      }
      renderPaymentState('deadline_passed', restored);
      return true;
    }
    const withinPaymentWindow = Number.isFinite(paymentDeadlineTime(status));
    if (status.payment_status === 'failed' || (status.payment_status === 'expired' && !withinPaymentWindow)) {
      if (!resumeFromDetail && !canRestoreTerminalRecovery(recovery)) {
        clearRegistrationRecovery();
        renderSelectedEvent();
        return false;
      }
      renderPaymentState(status.payment_status, restored);
      return true;
    }
    if (status.payment_status === 'refunded') {
      renderPaymentState('refunded', restored);
      clearRegistrationRecovery();
      return true;
    }

    const attemptExpiry = Date.parse(status.expires_at || '');
    if (!withinPaymentWindow && status.order_id && Number.isFinite(attemptExpiry) && attemptExpiry <= Date.now()) {
      if (!resumeFromDetail && !canRestoreTerminalRecovery(recovery)) {
        clearRegistrationRecovery();
        renderSelectedEvent();
        return false;
      }
      renderPaymentState('expired', restored);
      return true;
    }

    try {
      const payment = await createPayment(restored, recovery.email);
      renderPaymentState('pending', payment);
      pollPaymentStatus(payment, recovery.email);
    } catch (error) {
      if (error?.code === 'PAYMENT_DEADLINE_PASSED') {
        void handlePaymentDeadlineReached(restored);
      } else if (['PAYMENT_IN_PROGRESS', 'PAYMENT_AWAITING_CONFIRMATION', 'PAYMENT_ALREADY_PAID'].includes(error?.code)) {
        renderPaymentState('processing', restored);
        pollPaymentStatus(restored, recovery.email);
      } else {
        showPaymentRecoveryError(restored, retryRecovery);
      }
    }
    return true;
  };

  const checkPaymentStatus = async () => {
    if (manualPaymentCheckActive) return;
    const recovery = paymentContactFor(activePayment);
    if (!recovery) {
      showPaymentCheckNote('Status belum dapat diperiksa di perangkat ini. Muat ulang halaman atau hubungi admin dengan kode pendaftaranmu.');
      return;
    }
    const button = document.querySelector('#paymentStage [data-payment-check]');
    if (!button) return;
    manualPaymentCheckActive = true;
    button.disabled = true;
    button.textContent = 'Mengecek...';
    hidePaymentCheckNote();
    try {
      const result = await fetchRegistrationStatus(recovery, recovery.email);
      const restored = recoveryPaymentData(recovery, result);
      if (!applyPaymentStatusResult(result, restored)) {
        showPaymentCheckNote('Pembayaran belum kami terima. Jika sudah membayar, tunggu sebentar lalu cek lagi.');
        if (!paymentPollActive) pollPaymentStatus(restored, recovery.email);
      }
    } catch {
      showPaymentCheckNote('Status belum dapat diperiksa. Coba lagi sebentar.');
    } finally {
      manualPaymentCheckActive = false;
      button.disabled = false;
      button.textContent = 'Cek status pembayaran';
    }
  };

  document.querySelector('#paymentStage [data-payment-check]')?.addEventListener('click', checkPaymentStatus);

  document.querySelectorAll('#paymentStage [data-payment-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      const code = document.querySelector('#paymentStage [data-result-code]')?.textContent?.trim();
      const feedback = document.querySelector('#paymentStage [data-payment-copy-feedback]');
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code);
        const original = button.textContent;
        button.textContent = 'Tersalin';
        if (feedback) feedback.textContent = 'Kode pendaftaran tersalin.';
        window.setTimeout(() => { button.textContent = original; }, 1800);
      } catch {
        if (feedback) feedback.textContent = 'Kode belum dapat disalin. Silakan salin kode secara manual.';
      }
    });
  });

  const saveBlob = (blob, filename) => {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  };

  // A branded, shareable QRIS image drawn locally, so saving it never depends on Midtrans CORS.
  const drawQrisPoster = async (data, qr) => {
    const width = 1080;
    const height = 1480;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    await document.fonts?.ready?.catch?.(() => {});
    const font = (weight, size) => `${weight} ${size}px "DM Sans", "Instrument Sans", Arial, sans-serif`;
    const fitText = (text, maxWidth) => {
      let value = String(text || '');
      while (value.length > 1 && context.measureText(value).width > maxWidth) value = value.slice(0, -2);
      return value === String(text || '') ? value : `${value.trimEnd()}…`;
    };

    context.fillStyle = '#fbf8f4';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#7a1f2b';
    context.fillRect(0, 0, width, 260);
    context.fillStyle = 'rgba(255,255,255,.08)';
    context.beginPath(); context.arc(960, 40, 170, 0, Math.PI * 2); context.fill();
    context.beginPath(); context.arc(90, 260, 110, 0, Math.PI * 2); context.fill();

    const logo = new Image();
    logo.src = 'assets/logo/2.%20Logo%20Gabungan/Logo%20Kita%20Bahagiaa.png';
    const logoReady = await logo.decode().then(() => true).catch(() => false);
    if (logoReady) {
      // The logo file is maroon; tint it white for the maroon band (the site header does this with CSS).
      const tinted = document.createElement('canvas');
      tinted.width = 150;
      tinted.height = 150;
      const tint = tinted.getContext('2d');
      tint.drawImage(logo, 0, 0, 150, 150);
      tint.globalCompositeOperation = 'source-in';
      tint.fillStyle = '#ffffff';
      tint.fillRect(0, 0, 150, 150);
      context.drawImage(tinted, 64, 44);
    }
    context.fillStyle = '#ffffff';
    context.font = font(700, 30);
    context.fillText('PEMBAYARAN QRIS', logoReady ? 240 : 72, 118);
    context.font = font(700, 44);
    context.fillText(fitText(data.event_title || 'Kegiatan Kita Bahagia', logoReady ? 770 : 930), logoReady ? 240 : 72, 172);

    const cardX = 110;
    const cardY = 310;
    const cardSize = 860;
    context.fillStyle = '#ffffff';
    context.shadowColor = 'rgba(54,19,24,.12)';
    context.shadowBlur = 40;
    context.shadowOffsetY = 12;
    context.beginPath();
    if (typeof context.roundRect === 'function') context.roundRect(cardX, cardY, cardSize, cardSize, 48);
    else context.rect(cardX, cardY, cardSize, cardSize);
    context.fill();
    context.shadowColor = 'transparent';

    const count = qr.getModuleCount();
    const cell = Math.floor((cardSize - 120) / (count + QR_QUIET_ZONE * 2));
    const qrPixels = cell * count;
    const qrX = cardX + Math.round((cardSize - qrPixels) / 2);
    const qrY = cardY + Math.round((cardSize - qrPixels) / 2);
    context.fillStyle = '#231f20';
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (qr.isDark(row, col)) context.fillRect(qrX + col * cell, qrY + row * cell, cell, cell);
      }
    }

    context.textAlign = 'center';
    context.fillStyle = '#6f6667';
    context.font = font(500, 30);
    context.fillText('Total pembayaran', width / 2, 1248);
    context.fillStyle = '#7a1f2b';
    context.font = font(700, 64);
    context.fillText(typeof data.amount === 'number' ? formatEventPrice(data.amount) : '', width / 2, 1322);
    const deadline = Date.parse(data.payment_deadline || data.expires_at || '');
    context.fillStyle = '#231f20';
    context.font = font(500, 28);
    if (Number.isFinite(deadline)) {
      context.fillText(`Bayar sebelum ${new Intl.DateTimeFormat('id-ID', {
        weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta'
      }).format(new Date(deadline))} WIB`, width / 2, 1382);
    }
    context.fillStyle = '#6f6667';
    context.font = font(500, 24);
    context.fillText(`Kode ${data.registration_code || ''} · GoPay · ShopeePay · OVO · DANA · LinkAja · Mobile banking`, width / 2, 1432);

    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  };

  document.querySelector('#paymentStage [data-payment-download]')?.addEventListener('click', async () => {
    const image = document.querySelector('#paymentStage [data-payment-qr]');
    const note = document.querySelector('#paymentStage [data-payment-download-note]');
    if (note) { note.hidden = true; note.textContent = ''; }
    const drawnQr = buildQr(qrStringFor(activePayment));
    if (drawnQr) {
      const poster = await drawQrisPoster(activePayment, drawnQr).catch(() => null);
      if (poster) {
        saveBlob(poster, `qris-${activePayment.registration_code || 'kita-bahagia'}.png`);
        return;
      }
    }
    if (!image?.src) return;
    try {
      const response = await fetch(image.src);
      if (!response.ok) throw new Error('QR download failed');
      saveBlob(await response.blob(), 'qris-pembayaran-kita-bahagia.png');
    } catch {
      window.open(image.src, '_blank', 'noopener,noreferrer');
      if (note) {
        note.textContent = 'Jika unduhan tidak dimulai, buka QR lalu simpan gambar dari perangkatmu.';
        note.hidden = false;
      }
    }
  });

  document.querySelector('[data-payment-retry]')?.addEventListener('click', async (event) => {
    const recovery = readRegistrationRecovery();
    if (!recovery || !selectedEvent) return;
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Menyiapkan QRIS...';
    const staleRetryError = document.querySelector('#paymentStage [data-payment-retry-error]');
    if (staleRetryError) staleRetryError.hidden = true;
    try {
      const payment = await createPayment(recoveryPaymentData(recovery), recovery.email);
      renderPaymentState('pending', payment);
      pollPaymentStatus(payment, recovery.email);
    } catch (error) {
      if (['PAYMENT_IN_PROGRESS', 'PAYMENT_AWAITING_CONFIRMATION', 'PAYMENT_ALREADY_PAID'].includes(error?.code)) {
        renderPaymentState('processing', recoveryPaymentData(recovery));
        pollPaymentStatus(recoveryPaymentData(recovery), recovery.email);
        return;
      }
      if (error?.code === 'PAYMENT_DEADLINE_PASSED') {
        void handlePaymentDeadlineReached(recoveryPaymentData(recovery));
        return;
      }
      button.disabled = false;
      button.textContent = 'Coba lagi';
      const retryError = document.querySelector('#paymentStage [data-payment-retry-error]');
      if (retryError) {
        retryError.textContent = 'QRIS baru belum berhasil dibuat. Coba lagi beberapa saat lagi.';
        retryError.hidden = false;
      }
    }
  });

  if (paymentDemo) {
    registrationContent?.classList.add('hidden');
    eventFallback?.classList.add('hidden');
    registrationForm.querySelector('[type="submit"]').disabled = true;
    if (selectedEventIntro) selectedEventIntro.textContent = 'Pratinjau lokal · Bahagia Kasih';
    renderPaymentState(paymentDemo, {
      registration_code: 'KB-DEMO-123456', event_title: 'Bahagia Kasih (demo lokal)', amount: 35000
    });
  } else void initializeRegistrationEvent();

  const showRegistrationReview = () => {
    const formData = new FormData(registrationForm);
    const price = selectedEvent.price === null || selectedEvent.price === undefined
      ? 'Tidak tersedia' : formatEventPrice(selectedEvent.price);
    setDataText('[data-review-name]', String(formData.get('nama') || '').trim(), registrationReview);
    setDataText('[data-review-phone]', String(formData.get('telepon') || '').trim(), registrationReview);
    setDataText('[data-review-email]', String(formData.get('email') || '').trim(), registrationReview);
    setDataText('[data-review-domicile]', String(formData.get('domicile') || '').trim(), registrationReview);
    setDataText('[data-review-institution]', String(formData.get('institution') || '').trim(), registrationReview);
    setDataText('[data-review-happiness]', String(formData.get('bahagia') || '').trim(), registrationReview);
    const selectionReview = registrationReview?.querySelector('[data-review-selection]');
    if (selectionReview) {
      selectionReview.hidden = !(isSelectionEvent() && Boolean(selectedEvent.selectionQuestion));
      setDataText('[data-review-selection-question]', selectedEvent.selectionQuestion || '', registrationReview);
      setDataText('[data-review-selection-answer]', String(formData.get('selection_answer') || '').trim(), registrationReview);
    }
    const portfolioReview = registrationReview?.querySelector('[data-review-portfolio]');
    if (portfolioReview) {
      const cvFile = formData.get('cv');
      const items = [cvFile instanceof File && cvFile.size ? cvFile.name : '', String(formData.get('portfolio_url') || '').trim()].filter(Boolean);
      portfolioReview.hidden = !isFreeSelectionEvent() || !items.length;
      setDataText('[data-review-portfolio-value]', items.join(' · '), registrationReview);
    }
    setDataText('[data-review-event-title]', selectedEvent.name, registrationReview);
    setDataText('[data-review-event-date]', `${selectedEvent.date} · ${selectedEvent.time}`, registrationReview);
    setDataText('[data-review-event-location]', selectedEvent.location, registrationReview);
    setDataText('[data-review-event-price]', price, registrationReview);
    if (confirmRegistrationButton) {
      // Naming the amount here avoids a surprise on the payment step.
      confirmRegistrationButton.textContent = selectedEvent.price > 0
        ? `Lanjut bayar ${formatEventPrice(selectedEvent.price)}`
        : isSelectionEvent() ? 'Kirim pendaftaran' : 'Konfirmasi pendaftaran';
    }
    document.getElementById('registrationStatus')?.classList.add('hidden');
    registrationFormPanel?.classList.add('hidden');
    registrationReview?.classList.remove('hidden');
    setRegistrationStep('confirmation');
    focusRegistrationStep(registrationReview);
  };

  const telephoneInput = document.getElementById('telepon');
  const telephoneError = document.getElementById('teleponError');

  const getPhoneError = (rawValue) => {
    const raw = String(rawValue || '').trim();
    if (!raw) return 'Nomor WhatsApp wajib diisi.';
    if (!/^\+?[0-9\s().-]+$/.test(raw)) return 'Format nomor WhatsApp tidak valid.';
    const normalized = raw.replace(/[\s().-]/g, '');
    if (!/^\+?\d{8,20}$/.test(normalized)) return 'Nomor WhatsApp harus 8-20 digit angka.';
    return '';
  };

  const setPhoneError = (message) => {
    if (!telephoneInput || !telephoneError) return;
    telephoneError.textContent = message;
    telephoneError.hidden = !message;
    telephoneInput.setAttribute('aria-invalid', message ? 'true' : 'false');
  };

  const validatePhoneField = ({ focus = false } = {}) => {
    if (!telephoneInput) return true;
    const message = getPhoneError(telephoneInput.value);
    setPhoneError(message);
    if (message && focus) telephoneInput.focus();
    return !message;
  };

  telephoneInput?.addEventListener('input', () => {
    if (telephoneError && !telephoneError.hidden) validatePhoneField();
  });

  registrationForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (paymentDemo) return;
    if (detailViewRequested) {
      void resumePendingRegistration();
      return;
    }
    if (!selectedEvent || !registrationAvailable) return;
    const phoneValid = validatePhoneField();
    if (!registrationForm.checkValidity()) {
      registrationForm.reportValidity();
      return;
    }
    if (!phoneValid) {
      telephoneInput?.focus();
      return;
    }
    showRegistrationReview();
  });

  editRegistrationButton?.addEventListener('click', () => {
    if (isSubmitting || registrationCompleted) return;
    const resumeButton = document.getElementById('registrationResumeButton');
    if (resumeButton) resumeButton.hidden = true;
    registrationReview?.classList.add('hidden');
    registrationFormPanel?.classList.remove('hidden');
    setRegistrationStep('data');
    focusRegistrationStep(registrationFormPanel?.querySelector('.registration-form-heading'));
  });

  const registrationResumeButton = document.getElementById('registrationResumeButton');
  registrationResumeButton?.addEventListener('click', () => {
    registrationResumeButton.hidden = true;
    document.getElementById('registrationStatus')?.classList.add('hidden');
    void recoverRegistration({ resumeFromDetail: true });
  });

  confirmRegistrationButton?.addEventListener('click', async () => {
    if (!selectedEvent || !registrationAvailable || isSubmitting || registrationCompleted) return;
    if (registrationResumeButton) registrationResumeButton.hidden = true;

    if (!REGISTRATION_CONFIG.registrationEndpoint) {
      showRegistrationMessage('Backend pendaftaran belum dikonfigurasi. Pendaftaran belum dapat dikirim.', 'error');
      return;
    }
    const originalButtonText = confirmRegistrationButton.textContent;
    isSubmitting = true;
    registrationForm.setAttribute('aria-busy', 'true');
    confirmRegistrationButton.disabled = true;
    editRegistrationButton.disabled = true;
    confirmRegistrationButton.textContent = 'Memproses...';
    showRegistrationMessage('Mengirim data pendaftaran...', 'pending');

    try {
      const registration = await submitRegistration(registrationForm, selectedEvent.slug);
      const registrationEmail = String(new FormData(registrationForm).get('email') || '').trim().toLowerCase();
      const code = String(registration.registration_code || '');
      const title = String(registration.event_title || selectedEvent.name);
      if (!code || typeof registration.amount !== 'number'
        || typeof registration.registration_status !== 'string'
        || typeof registration.payment_status !== 'string') throw { code: 'SERVER_ERROR' };
      const isFreeConfirmed = registration.registration_status === 'confirmed'
        && registration.payment_status === 'not_required';
      const isApplied = registration.registration_status === 'applied'
        && registration.payment_status === 'not_required';
      const isPaidPending = registration.registration_status === 'pending_payment'
        && registration.payment_status === 'unpaid' && registration.amount > 0;
      persistRegistrationRecovery(registration, registrationEmail);

      if (isFreeConfirmed || isApplied) {
        showRegistrationMessage(`Pendaftaran ${title} sudah tercatat. Kode pendaftaran kamu: ${code}.`, 'success');
      } else if (isPaidPending) {
        const payment = await createPayment(registration, registrationEmail);
        showRegistrationMessage(`Pendaftaran ${title} sudah tercatat dengan kode ${code}.`, 'success');
        renderPaymentState('pending', payment);
        document.getElementById('registrationStatus')?.classList.add('hidden');
        pollPaymentStatus(payment, registrationEmail);
      } else {
        throw { code: 'SERVER_ERROR' };
      }
      registrationCompleted = true;
      confirmRegistrationButton.textContent = 'Pendaftaran tercatat';
      const resultStage = isFreeConfirmed || isApplied ? document.getElementById('freeRegistrationConfirmation') : null;
      if (resultStage && isApplied) {
        showFreeRegistrationConfirmation({ ...registration, event_title: title });
      } else if (resultStage) {
        showFreeRegistrationConfirmation({
          ...registration,
          event_title: title,
          whatsapp_group_url: null
        });
        try {
          const status = await fetchRegistrationStatus(
            registration,
            registrationEmail,
          );
          if (status.registration_status === 'confirmed' && status.payment_status === 'not_required') {
            renderOnboarding(resultStage.querySelector('[data-registration-onboarding]'), status);
          }
        } catch {
          // The confirmed registration remains visible if onboarding lookup is temporarily unavailable.
        }
      }
      window.KBReceipt?.actions(isPaidPending ? document.getElementById('paymentStage') : resultStage, registration);
    } catch (error) {
      const code = typeof error?.code === 'string' ? error.code : 'SERVER_ERROR';
      showRegistrationMessage(registrationErrorMessages[code] || registrationErrorMessages.SERVER_ERROR, 'error');
      // This device still has the earlier registration for this event: offer the existing recovery flow.
      if (code === 'ALREADY_REGISTERED' && registrationResumeButton) {
        const submittedEmail = String(new FormData(registrationForm).get('email') || '').trim().toLowerCase();
        const stored = readRegistrationRecovery();
        registrationResumeButton.hidden = !stored || stored.email !== submittedEmail;
      }
    } finally {
      isSubmitting = false;
      registrationForm.removeAttribute('aria-busy');
      if (!registrationCompleted) {
        confirmRegistrationButton.disabled = false;
        editRegistrationButton.disabled = false;
        confirmRegistrationButton.textContent = originalButtonText;
      }
    }
  });
}

// cek-status.html: look up a registration by code + email (same endpoint as payment recovery).
const statusForm = document.getElementById('statusForm');
if (statusForm) {
  const message = document.getElementById('statusMessage');
  const result = document.getElementById('statusResult');
  const codeInput = document.getElementById('statusCode');
  const prefill = new URLSearchParams(window.location.search).get('kode');
  if (prefill && codeInput) codeInput.value = prefill.slice(0, 50);
  statusForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = statusForm.querySelector('[type="submit"]');
    const formData = new FormData(statusForm);
    result.hidden = true;
    message.textContent = 'Memeriksa status...';
    button.disabled = true;
    try {
      const response = await fetch(`${SUPABASE_FUNCTIONS_BASE_URL}/payment-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          registration_code: String(formData.get('registration_code') || '').trim().toUpperCase(),
          email: String(formData.get('email') || '').trim().toLowerCase()
        }),
        signal: AbortSignal.timeout(10000)
      });
      const data = await response.json().catch(() => null);
      if (response.status === 404 || response.status === 400) {
        message.textContent = 'Pendaftaran tidak ditemukan. Periksa kembali kode pendaftaran dan email yang kamu pakai saat mendaftar.';
        return;
      }
      if (!response.ok || !data?.registration_status) throw new Error('status');
      const outcome = registrationOutcomeCopy(data);
      result.querySelector('[data-status-event]').textContent = data.event_title || '';
      result.querySelector('[data-status-heading]').textContent = outcome.heading;
      result.querySelector('[data-status-copy]').textContent = outcome.copy;
      const link = result.querySelector('[data-status-whatsapp]');
      const groupUrl = outcome.onboarding ? safeWhatsAppGroupUrl(data.whatsapp_group_url) : null;
      link.hidden = !groupUrl;
      if (groupUrl) link.href = groupUrl;
      else link.removeAttribute('href');
      message.textContent = '';
      result.hidden = false;
      result.focus();
    } catch {
      message.textContent = 'Status belum dapat diperiksa. Coba lagi beberapa saat lagi.';
    } finally {
      button.disabled = false;
    }
  });
}
