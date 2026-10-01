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

const fetchPublicEvents = async ({ slug = null, limit = null, past = false } = {}) => {
  const url = new URL(`${SUPABASE_FUNCTIONS_BASE_URL}/public-events`);
  if (PUBLIC_EVENTS_CONFIG.demo) url.searchParams.set('demo', 'true');
  if (past) url.searchParams.set('past', 'true');
  if (slug) url.searchParams.set('slug', slug);
  if (limit !== null) url.searchParams.set('limit', String(limit));

  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
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
    locationUrl: safeMapsUrl(event.location_url),
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
    cvRequested: event.cv_requested === true,
    cvNote: event.cv_note || '',
    remainingCapacity: event.remaining_capacity,
    registrationDeadline: event.registration_deadline || null,
    paymentWindowMinutes: Number.isInteger(event.payment_window_minutes) ? event.payment_window_minutes : null,
    documentationUrl: event.documentation_url || null,
    documentationPhotos: Array.isArray(event.documentation_photos) ? event.documentation_photos : []
  };
};

// Documentation gallery (finished event page + related Kisah): up to 5 photos and the Drive folder.
// Documentation photos as prints taped into a field journal (Oct 2026; scroll mechanics after
// 21st.dev "Filmstrip Gallery"): the centred print straightens and lifts (.is-developed), a tap
// on it opens a native <dialog>, a tap on another print rolls that one to the centre.
const renderEventGallery = (container, { title, documentationUrl, photos }) => {
  const slides = (Array.isArray(photos) ? photos : [])
    .filter((photo) => typeof photo?.url === 'string' && photo.url.startsWith('https://')).slice(0, 5);
  let drive = null;
  try {
    const url = new URL(documentationUrl || '');
    if (url.protocol === 'https:') drive = url.toString();
  } catch { drive = null; }
  container.hidden = !slides.length && !drive;
  if (container.hidden) {
    container.replaceChildren();
    return;
  }
  const altOf = (photo, index) => photo.alt || `Foto kegiatan ${index + 1}`;
  container.innerHTML = `
    <div class="event-gallery-head"><p class="event-gallery-kicker">Dokumentasi</p><h2>Momen dari <em>${escapeHTML(title)}</em></h2></div>
    ${slides.length ? `<div class="event-gallery-track${slides.length === 1 ? ' is-single' : ''}" tabindex="0" aria-label="Foto kegiatan, geser atau pakai panah untuk melihat">${slides.map((photo, index) => `
      <figure class="event-gallery-slide"><button type="button" class="event-gallery-frame" data-gallery-open="${index}" aria-label="Perbesar: ${escapeHTML(altOf(photo, index))}"><img src="${escapeHTML(photo.url)}" alt="${escapeHTML(altOf(photo, index))}" loading="lazy" decoding="async"></button>${photo.alt ? `<figcaption>${escapeHTML(photo.alt)}</figcaption>` : ''}</figure>`).join('')}
    </div>
    <dialog class="event-gallery-lightbox" aria-label="Foto kegiatan"><img alt=""><button type="button" class="event-gallery-close" data-gallery-close aria-label="Tutup">&times;</button></dialog>` : ''}
    <div class="event-gallery-foot">
      ${slides.length > 1 ? `<div class="event-gallery-nav"><button type="button" data-gallery-step="-1" aria-label="Foto sebelumnya">&larr;</button><span data-gallery-count>1 / ${slides.length}</span><button type="button" data-gallery-step="1" aria-label="Foto berikutnya">&rarr;</button></div>` : ''}
      ${drive ? `<a class="btn btn-secondary event-gallery-drive" href="${escapeHTML(drive)}" target="_blank" rel="noopener noreferrer">Lihat semua foto di Drive <span aria-hidden="true">&nearr;</span></a>` : ''}
    </div>`;
  const track = container.querySelector('.event-gallery-track');
  if (!track) return;
  const frames = [...track.querySelectorAll('.event-gallery-slide')];
  const count = container.querySelector('[data-gallery-count]');
  const instant = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let active = -1;
  const develop = () => {
    const middle = track.scrollLeft + track.clientWidth / 2;
    let nearest = 0;
    frames.forEach((frame, index) => {
      const distance = Math.abs(frame.offsetLeft + frame.offsetWidth / 2 - middle);
      const best = Math.abs(frames[nearest].offsetLeft + frames[nearest].offsetWidth / 2 - middle);
      if (distance < best) nearest = index;
    });
    if (nearest === active) return;
    active = nearest;
    frames.forEach((frame, index) => frame.classList.toggle('is-developed', index === nearest));
    if (count) count.textContent = `${nearest + 1} / ${frames.length}`;
  };
  const goTo = (index) => {
    const frame = frames[Math.min(frames.length - 1, Math.max(0, index))];
    track.scrollTo({ left: frame.offsetLeft - (track.clientWidth - frame.offsetWidth) / 2, behavior: instant() ? 'auto' : 'smooth' });
  };
  let queued = false;
  track.addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; develop(); });
  }, { passive: true });
  window.addEventListener('resize', develop, { passive: true });
  develop();
  track.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    goTo(active + (event.key === 'ArrowRight' ? 1 : -1));
  });
  container.querySelectorAll('[data-gallery-step]').forEach((button) => button.addEventListener('click', () => {
    goTo(active + Number(button.dataset.galleryStep));
  }));
  const lightbox = container.querySelector('.event-gallery-lightbox');
  const lightboxImage = lightbox.querySelector('img');
  track.addEventListener('click', (event) => {
    const button = event.target.closest('[data-gallery-open]');
    if (!button) return;
    const index = Number(button.dataset.galleryOpen);
    // An off-centre frame first rolls into the gate; the centred one opens.
    if (index !== active) { goTo(index); return; }
    lightboxImage.src = slides[index].url;
    lightboxImage.alt = altOf(slides[index], index);
    lightbox.showModal();
  });
  lightbox.addEventListener('click', (event) => {
    if (event.target === lightbox || event.target.closest('[data-gallery-close]')) lightbox.close();
  });
};

const eventRegistrationAvailability = (event) => {
  const availabilityEnd = new Date(event.end || event.start).getTime();
  // A finished event is "past" even if it was full or closed (it then shows its documentation).
  if (event.statusKey === 'completed' || (!Number.isNaN(availabilityEnd) && availabilityEnd < Date.now())) {
    return { available: false, reason: 'past' };
  }
  if (event.statusKey === 'full') return { available: false, reason: 'full' };
  if (event.statusKey === 'closed') return { available: false, reason: 'closed' };
  if (Number.isNaN(availabilityEnd) || event.statusKey !== 'open') {
    return { available: false, reason: 'unavailable' };
  }
  if (event.applicantsFull) return { available: false, reason: 'applicants_full' };
  const opensAt = Date.parse(event.registrationOpensAt || '');
  if (Number.isFinite(opensAt) && opensAt > Date.now()) return { available: false, reason: 'not_yet', opensAt };
  return { available: true, reason: null };
};


// Event cards shared by the schedule page and the homepage.
const jakartaIsoDay = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Jakarta' });
// Calendar-day number in Jakarta, so "N hari lagi" counts dates, not 24-hour blocks.
const jakartaDayNumber = (date) => {
  const [year, month, day] = jakartaIsoDay.format(date).split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 864e5;
};
const eventHref = (event) => `pendaftaran.html?event=${encodeURIComponent(event.slug)}`;
// Calendar days until registration closes, or null without a deadline.
const eventDaysLeft = (event) => {
  const deadline = new Date(event.registrationDeadline || '');
  return Number.isNaN(deadline.getTime()) ? null : jakartaDayNumber(deadline) - jakartaDayNumber(new Date());
};
const eventDaysLeftLabel = (days) => days <= 0 ? 'Hari ini' : days === 1 ? 'Besok' : `${days} hari lagi`;
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
  // Closed or finished events: the poster badge already says so, a seat count would mislead.
  if (['closed', 'past'].includes(availability.reason)) return '';
  const remaining = event.remainingCapacity;
  if (event.statusKey === 'full' || remaining === 0) return '<span class="event-slot is-full">Kuota penuh</span>';
  if (Number.isInteger(remaining) && remaining <= 5 && eventRegistrationAvailability(event).available) {
    return `<span class="event-slot is-low">Tinggal ${remaining} slot</span>`;
  }
  return `<span class="event-slot">${escapeHTML(event.capacity)}</span>`;
};
// Poster badge: unavailable events get a dark state label and only full ones turn grayscale
// (finished events keep their colours); open ones closing within a week get "3 hari lagi".
const eventPhotoBadge = (event) => {
  const { available, reason } = eventRegistrationAvailability(event);
  const closedLabels = { past: 'Selesai', full: 'Kuota penuh', closed: 'Ditutup', applicants_full: 'Ditutup' };
  if (closedLabels[reason]) return { closed: true, grayscale: reason === 'full', label: closedLabels[reason] };
  const days = eventDaysLeft(event);
  if (available && days !== null && days >= 0 && days <= 7) return { closed: false, label: eventDaysLeftLabel(days) };
  return null;
};
const eventPhoto = (event, className) => {
  const badge = eventPhotoBadge(event);
  return `<figure class="${className}${event.image ? '' : ' is-empty'}${badge?.grayscale ? ' is-closed' : ''}">${event.image
    ? `<img src="${escapeHTML(event.image)}" alt="${escapeHTML(event.imageAlt)}" loading="lazy" decoding="async">` : ''}${badge
    ? `<span class="event-photo-badge${badge.closed ? ' is-closed' : ''}">${escapeHTML(badge.label)}</span>` : ''}</figure>`;
};
const eventIsPast = (event) => eventRegistrationAvailability(event).reason === 'past';

// Posters are 4:5 and shown whole; photos of any other shape fill the frame instead of leaving a blank band.
const fitEventPhoto = (img) => {
  if (!img.naturalWidth) return;
  const ratio = img.naturalWidth / img.naturalHeight;
  img.closest('.event-card-photo')?.classList.toggle('is-cover', Math.abs(ratio - 0.8) > 0.06);
};
document.addEventListener('load', (event) => {
  if (event.target instanceof HTMLImageElement && event.target.closest('.event-card-photo')) fitEventPhoto(event.target);
}, true);
const fitEventPhotos = (container) => container.querySelectorAll('.event-card-photo img').forEach((img) => { if (img.complete) fitEventPhoto(img); });

// Poster card (homepage "Kegiatan Terdekat" and the schedule grid) with title, place, date and price; the whole card links.
const eventCardIcon = {
  place: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="9.5" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  date: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 10h17M8 3v4M16 3v4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
};
const eventCardMarkup = (event, attributes = '') => `<article class="event-card${eventIsPast(event) ? ' is-past' : ''}"${attributes}>
  ${eventPhoto(event, 'event-card-photo')}
  <div class="event-card-body">
    <p class="event-kicker">${escapeHTML(event.category)}</p>
    <h3 class="event-title"><a class="event-row-link" href="${eventHref(event)}">${escapeHTML(event.name)}</a></h3>
    <ul class="event-card-meta">
      <li>${eventCardIcon.place}<span>${escapeHTML(event.location)}</span></li>
      <li>${eventCardIcon.date}<span>${escapeHTML(event.date)}</span></li>
    </ul>
    <div class="event-card-foot"><div><strong class="event-price">${formatEventPrice(event.price)}</strong>${eventSlotNote(event)}</div><span class="event-card-cta" aria-hidden="true">${eventRegistrationAvailability(event).available ? 'Daftar' : 'Lihat detail'} <span>&rarr;</span></span></div>
  </div>
</article>`;


const skeletonLine = (size = '') => `<span class="loading-line${size ? ` loading-line-${size}` : ''}"></span>`;
const eventCardSkeleton = (className = 'schedule-card') => `<article class="${className} loading-card" aria-hidden="true">
  <div class="loading-media"></div>
  <div class="loading-card-copy">${skeletonLine('short')}${skeletonLine('title')}${skeletonLine('title-short')}
    <div class="loading-meta">${skeletonLine('meta')}${skeletonLine('meta')}${skeletonLine('meta-short')}</div>
  </div>
</article>`;

// Hero "Berikutnya" strip: the next event that still takes registrations (else the next one),
// floated on the hero's bottom row so filling it in never shifts the title.
const renderHeroNext = (events) => {
  const link = document.querySelector('[data-hero-next]');
  const text = link?.querySelector('[data-hero-next-text]');
  if (!link || !text) return;
  const next = events.find((event) => eventRegistrationAvailability(event).available) || events[0];
  if (!next) return;
  const days = eventRegistrationAvailability(next).available ? eventDaysLeft(next) : null;
  const parts = [next.name, eventShortDateFormatter.format(new Date(next.start))];
  if (next.location && next.location !== 'Lokasi menyusul') parts.push(next.location);
  if (days !== null && days >= 0 && days <= 7) parts.push(`tutup ${eventDaysLeftLabel(days).toLowerCase()}`);
  text.textContent = parts.join(' · ');
  link.href = eventHref(next);
  link.setAttribute('aria-label', `Kegiatan berikutnya: ${parts.join(', ')}`);
  link.hidden = false;
};

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
  list.innerHTML = `${eventCardSkeleton('event-card')}${eventCardSkeleton('event-card')}${eventCardSkeleton('event-card')}`;
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

  renderHeroNext(events);
  list.innerHTML = events.map(eventCardMarkup).join('');
  fitEventPhotos(list);
  list.hidden = false;
  list.removeAttribute('aria-busy');
  empty.hidden = true;
};

const renderScheduleEvents = async () => {
  const grid = document.getElementById('scheduleGrid');
  const empty = document.getElementById('scheduleEmpty');
  const count = document.getElementById('scheduleCount');
  if (!grid) return;
  if (scheduleEventsLoading) return;

  const setMessage = (title, detail, retry = null) => {
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
  empty?.classList.add('hidden');
  grid.innerHTML = `${eventCardSkeleton('event-card')}${eventCardSkeleton('event-card')}${eventCardSkeleton('event-card')}`;
  grid.setAttribute('aria-busy', 'true');

  let scheduleEvents;
  let pastEvents;
  try {
    // Finished events are extra: if they fail to load, the schedule still shows.
    const [upcoming, finished] = await Promise.all([
      fetchPublicEvents(),
      fetchPublicEvents({ past: true, limit: 12 }).catch((error) => {
        console.error('Kegiatan selesai gagal dimuat', error);
        return [];
      })
    ]);
    const all = [...upcoming, ...finished].map(normalizeScheduleEvent).filter(Boolean)
      .filter((event, index, list) => list.findIndex((other) => other.slug === event.slug) === index);
    scheduleEvents = all.filter((event) => !eventIsPast(event))
      .sort((a, b) => new Date(a.start) - new Date(b.start));
    pastEvents = all.filter(eventIsPast).sort((a, b) => new Date(b.start) - new Date(a.start));
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

  if (!scheduleEvents.length && !pastEvents.length) {
    grid.removeAttribute('aria-busy');
    if (count) {
      count.classList.remove('visually-hidden');
      count.textContent = 'Menampilkan 0 kegiatan';
    }
    setMessage('Belum ada kegiatan yang tersedia.', 'Silakan cek kembali untuk agenda berikutnya.');
    return;
  }

  // KB publishes a handful of events a month about a week ahead, so the schedule is one card grid
  // with two tabs (Mendatang / Sudah selesai); poster badges carry "N hari lagi" and "Kuota penuh".
  grid.innerHTML = [...scheduleEvents, ...pastEvents]
    .map((event) => eventCardMarkup(event, eventIsPast(event) ? ' data-past' : '')).join('');
  fitEventPhotos(grid);
  grid.removeAttribute('aria-busy');
  count?.classList.remove('visually-hidden');
  if (empty && scheduleEmptyDefaultMarkup !== undefined) empty.innerHTML = scheduleEmptyDefaultMarkup;
  const pastTab = document.querySelector('[data-schedule-filter="past"]');
  if (pastTab) pastTab.hidden = !pastEvents.length;
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

  // Slides 2-3 photos wait until the page has loaded so they don't slow the first photo.
  const loadHeroPhotos = () => {
    heroSlider.querySelectorAll('[data-srcset], [data-src]').forEach(el => {
      if (el.dataset.srcset) el.srcset = el.dataset.srcset;
      if (el.dataset.src) el.src = el.dataset.src;
      delete el.dataset.srcset;
      delete el.dataset.src;
    });
  };
  if (document.readyState === 'complete') loadHeroPhotos();
  else window.addEventListener('load', loadHeroPhotos, { once: true });

  const updateHeroSlider = () => {
    if (heroIndex) loadHeroPhotos();
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

// Photos fade in as they finish loading (CSS .img-fade). Images already loaded now, and the hero
// (it has its own motion and is the first paint), are marked ready so they never blink.
if (window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
  const markLoaded = ({ target }) => {
    if (target instanceof HTMLImageElement && !target.classList.contains('is-ready')) target.classList.add('is-loaded');
  };
  document.addEventListener('load', markLoaded, true);
  document.addEventListener('error', markLoaded, true);
  document.querySelectorAll('main img').forEach((image) => {
    if (image.complete || image.closest('.hero-slide')) image.classList.add('is-ready');
  });
  document.documentElement.classList.add('img-fade');
}

// Blocks below the first screen also fade in as they scroll into view. Added only by JS (so
// nothing stays hidden without it), never with reduced motion, not on the registration flow,
// and not for blocks already on screen or still hidden at load.
if (window.matchMedia('(prefers-reduced-motion: no-preference)').matches && 'IntersectionObserver' in window
  && !document.body.classList.contains('registration-page')) {
  document.querySelectorAll('main > section:not(:first-child) > .container > *').forEach((item) => {
    const top = item.getBoundingClientRect().top;
    if (item.hidden || item.classList.contains('sr-only') || top === 0 || top < window.innerHeight) return;
    item.classList.add('reveal');
  });
}
// Homepage motion inspired by dashdigital.studio: section titles rise word by word from behind a
// mask, heading rules draw left to right, buttons roll their label on hover, and the header slides
// away while scrolling down on phones/tablets. Beranda only, never with reduced motion. Titles
// already on screen at load stay static (no layout shift for the first paint).
const homeMotion = document.body.classList.contains('home-page')
  && window.matchMedia('(prefers-reduced-motion: no-preference)').matches && 'IntersectionObserver' in window;
if (homeMotion) {
  document.documentElement.classList.add('home-motion');
  const splitWords = (node, counter) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.ELEMENT_NODE) { splitWords(child, counter); return; }
      if (child.nodeType !== Node.TEXT_NODE || !child.textContent.trim()) return;
      const fragment = document.createDocumentFragment();
      child.textContent.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) { fragment.append(document.createTextNode(' ')); return; }
        const outer = document.createElement('span');
        const inner = document.createElement('span');
        outer.className = 'split-word';
        outer.setAttribute('aria-hidden', 'true');
        inner.style.setProperty('--word', String(counter.index++));
        inner.textContent = part;
        outer.append(inner);
        fragment.append(outer);
      });
      child.replaceWith(fragment);
    });
  };
  const inView = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-in');
      inView.unobserve(entry.target);
    });
  }, { threshold: 0.25 });
  // Jejak's title is left whole: it settles from a large size on scroll instead (style.css).
  document.querySelectorAll('.home-page main > section:not(.hero-campaign, .impact-editorial, .home-about-teaser) h2').forEach((heading) => {
    if (heading.getBoundingClientRect().top < window.innerHeight) return;
    heading.setAttribute('aria-label', heading.textContent.replace(/\s+/g, ' ').trim());
    splitWords(heading, { index: 0 });
    heading.classList.add('split-heading');
    inView.observe(heading);
  });
  // The manifesto lights up word by word as it crosses the screen, so it is read, not skimmed.
  const manifesto = document.querySelector('.home-about-teaser h2');
  if (manifesto) {
    manifesto.setAttribute('aria-label', manifesto.textContent.replace(/\s+/g, ' ').trim());
    splitWords(manifesto, { index: 0 });
    manifesto.classList.add('ink-heading');
    const words = [...manifesto.querySelectorAll('.split-word')];
    let lit = -1;
    let queued = false;
    const paint = () => {
      queued = false;
      const box = manifesto.getBoundingClientRect();
      const start = window.innerHeight * .85;
      const end = window.innerHeight * .4;
      const progress = Math.min(Math.max((start - box.top) / (start - end + box.height), 0), 1);
      const count = Math.round(progress * words.length);
      if (count === lit) return;
      words.forEach((word, index) => word.classList.toggle('is-lit', index < count));
      lit = count;
    };
    window.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(paint); } }, { passive: true });
    paint();
  }
  // Footer reveal: the page lifts like a sheet off a footer parked underneath. Only when the footer
  // fits the screen (a taller one would pin its bottom first), so phones keep the normal footer.
  const footer = document.querySelector('.home-page .site-footer');
  const fitFooter = () => document.documentElement.classList.toggle('footer-reveal', !!footer && footer.offsetHeight < window.innerHeight - 40);
  fitFooter();
  window.addEventListener('resize', fitFooter, { passive: true });
  // Block reveal on the two key photos; the featured story arrives later from js/stories.js.
  const blockReveal = (scope) => scope.querySelectorAll('.impact-editorial-image, .kisah-preview .kisah-entry-featured .kisah-image-link')
    .forEach((photo) => {
      if (photo.classList.contains('block-reveal')) return;
      photo.classList.add('block-reveal');
      inView.observe(photo);
    });
  blockReveal(document);
  const storyPreview = document.querySelector('.home-page .kisah-preview');
  if (storyPreview) new MutationObserver(() => blockReveal(storyPreview)).observe(storyPreview, { childList: true, subtree: true });
  document.querySelectorAll('.home-program-section .program-grid, .home-page .kisah-section-heading, .home-upcoming-list')
    .forEach((rule) => { rule.classList.add('draw-rule'); inView.observe(rule); });
  document.querySelectorAll('.home-page main .btn').forEach((button) => {
    const label = button.textContent.replace(/\s+/g, ' ').trim();
    if (!label || button.children.length) return;
    const roll = document.createElement('span');
    const text = document.createElement('span');
    roll.className = 'btn-roll';
    roll.dataset.label = label;
    text.textContent = label;
    roll.append(text);
    button.replaceChildren(roll);
  });
  const header = document.querySelector('.home-page .site-header');
  const compactHeader = window.matchMedia('(max-width: 1023px)');
  let lastY = window.scrollY;
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    const hide = compactHeader.matches && y > lastY + 4 && y > 160 && !document.body.classList.contains('mobile-menu-open');
    if (hide) header?.classList.add('is-tucked');
    else if (y < lastY - 4 || y <= 160) header?.classList.remove('is-tucked');
    lastY = y;
  }, { passive: true });
  // Hero → Jejak: the hero sinks slower than the page while Jejak slides over it like a sheet. The
  // progress eases toward the scroll position, so wheel notches glide instead of stepping.
  const hero = document.querySelector('.home-page .hero-campaign');
  if (hero) {
    const goal = () => Math.min(Math.max(window.scrollY / window.innerHeight, 0), 1);
    let depth = goal();
    let frame = 0;
    const step = () => {
      const target = goal();
      depth += (target - depth) * .14;
      if (Math.abs(target - depth) < .0005) depth = target;
      hero.style.setProperty('--hero-depth', depth.toFixed(4));
      // Never sink further than the page has scrolled, or a gap opens above the hero on the way back up.
      hero.style.setProperty('--hero-shift', `${Math.min(depth * window.innerHeight * .3, window.scrollY).toFixed(1)}px`);
      frame = depth === target ? 0 : requestAnimationFrame(step);
    };
    window.addEventListener('scroll', () => { if (!frame) frame = requestAnimationFrame(step); }, { passive: true });
    step();
  }
}

// Any page seen in this visit means Beranda's loader (js/loader-gate.js) is skipped from now on.
try { sessionStorage.setItem('kb_visit', '1'); } catch { /* storage blocked: the gate treats that as seen */ }

// Page curtain (after dashdigital.studio): on an internal link click a maroon panel rises at once and
// the KB logo fades in, then the browser navigates behind it. The cross-document view transition in
// style.css keeps that covered frame and opens the new page upward from the bottom, so the wait for
// the next page happens behind the logo instead of as a frozen screen. Only where cross-document view
// transitions exist (elsewhere links behave normally) and never with reduced motion.
if ('onpagereveal' in window && window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
  const curtain = document.createElement('div');
  curtain.className = 'page-curtain';
  curtain.setAttribute('aria-hidden', 'true');
  const curtainLogo = document.createElement('img');
  curtainLogo.src = '/assets/logo/logo-kita-bahagia-white.webp';
  curtainLogo.alt = '';
  curtain.append(curtainLogo);
  document.body.append(curtain);
  const CURTAIN_MS = 560;
  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[href]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if ((link.target && link.target !== '_self') || link.hasAttribute('download')) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || !/^https?:$/.test(url.protocol)) return;
    if (url.pathname === location.pathname && url.search === location.search) return;
    event.preventDefault();
    curtain.classList.add('is-covering');
    setTimeout(() => { location.href = url.href; }, CURTAIN_MS);
  });
  // Back/forward restores this page from the cache with the curtain still up.
  window.addEventListener('pageshow', () => curtain.classList.remove('is-covering'));
}

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

// Jejak numbers count up once when scrolled into view. The HTML keeps the final value, screen
// readers get it straight away, and a year (2024) or reduced motion leaves the number as is.
const impactCounters = [...document.querySelectorAll('.impact-editorial-stat strong')].flatMap((stat) => {
  const [, end, suffix] = stat.textContent.trim().match(/^(\d+)(\D*)$/) || [];
  return end && Number(end) < 1000 ? [{ stat, end: Number(end), suffix }] : [];
});
if (impactCounters.length && 'IntersectionObserver' in window
  && window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
  const countObserver = new IntersectionObserver((entries) => {
    entries.forEach(({ isIntersecting, target }) => {
      if (!isIntersecting) return;
      countObserver.unobserve(target);
      const { end, suffix, shown } = impactCounters.find(({ stat }) => stat === target);
      const start = performance.now();
      const tick = (now) => {
        const progress = Math.min((now - start) / 1400, 1);
        shown.textContent = `${Math.round(end * (1 - (1 - progress) ** 3))}${suffix}`;
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, { threshold: 0.6 });
  impactCounters.forEach((counter) => {
    const label = document.createElement('span');
    label.className = 'visually-hidden';
    label.textContent = `${counter.end}${counter.suffix}`;
    counter.shown = document.createElement('span');
    counter.shown.setAttribute('aria-hidden', 'true');
    counter.shown.textContent = `0${counter.suffix}`;
    counter.stat.replaceChildren(label, counter.shown);
    countObserver.observe(counter.stat);
  });
}

// Homepage programs on desktop: one sticky photo that curtains to the program whose text is passing
// the middle of the screen. The stage copies the cards' own images (same files, already loading);
// CSS only uses it from 901px, so phones keep the alternating rows.
const programGrid = document.querySelector('.home-program-section .program-grid');
const programCards = programGrid ? [...programGrid.querySelectorAll(':scope > .program-card')] : [];
const programPhotos = programCards.map((card) => card.querySelector('.program-image img'));
if (programCards.length && programPhotos.every(Boolean) && 'IntersectionObserver' in window) {
  const stage = document.createElement('div');
  stage.className = 'program-stage';
  stage.setAttribute('aria-hidden', 'true');
  const stagePhotos = programPhotos.map((photo) => {
    const copy = photo.cloneNode();
    copy.alt = '';
    copy.removeAttribute('fetchpriority');
    return copy;
  });
  stage.append(...stagePhotos);
  stage.style.gridRow = `1 / span ${programCards.length}`;
  programGrid.append(stage); // last, so the cards keep their :nth-child styles
  programGrid.classList.add('has-stage');
  let activeProgram = -1;
  const showProgram = (index) => {
    if (index === activeProgram || index < 0) return;
    stagePhotos.forEach((photo) => photo.classList.remove('is-prev'));
    stagePhotos[activeProgram]?.classList.replace('is-active', 'is-prev');
    stagePhotos[index].classList.add('is-active');
    activeProgram = index;
  };
  showProgram(0);
  const programObserver = new IntersectionObserver((entries) => {
    entries.forEach(({ isIntersecting, target }) => {
      if (isIntersecting) showProgram(programCards.indexOf(target));
    });
  }, { rootMargin: '-45% 0px -45% 0px' });
  programCards.forEach((card) => programObserver.observe(card));
}

function initializeScheduleFilters() {
  const tabs = [...document.querySelectorAll('[data-schedule-filter]')];
  const cards = [...document.querySelectorAll('#scheduleGrid .event-card')];
  const scheduleCount = document.getElementById('scheduleCount');
  const scheduleEmpty = document.getElementById('scheduleEmpty');
  if (!tabs.length) return;

  let activeFilter = tabs.find((tab) => tab.classList.contains('active'))?.dataset.scheduleFilter || 'upcoming';
  const applyFilters = () => {
    let visible = 0;
    cards.forEach((card) => {
      const match = (activeFilter === 'past') === card.hasAttribute('data-past');
      card.classList.toggle('hidden', !match);
      if (match) visible += 1;
    });
    if (scheduleCount) scheduleCount.textContent = `Menampilkan ${visible} kegiatan`;
    scheduleEmpty?.classList.toggle('hidden', visible !== 0);
  };

  tabs.forEach((button) => {
    if (button.dataset.bound) return;
    button.dataset.bound = 'true';
    button.addEventListener('click', () => {
      activeFilter = button.dataset.scheduleFilter;
      tabs.forEach((item) => {
        item.classList.toggle('active', item === button);
        item.setAttribute('aria-pressed', String(item === button));
      });
      applyFilters();
    });
  });
  applyFilters();
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

const safeMapsUrl = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
};

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
    expired: ['QRIS kedaluwarsa', 'Kode QRIS ini sudah tidak berlaku, tapi pendaftaranmu masih tersimpan. Selama batas waktu pembayaran belum lewat, slotmu tetap ditahan. Buat QRIS baru untuk melanjutkan pembayaran, tidak perlu daftar ulang.'],
    failed: ['Pembayaran belum berhasil', 'Pembayaran tidak berhasil diselesaikan, tapi pendaftaranmu tetap tercatat. Selama batas waktu pembayaran belum lewat, buat QRIS baru untuk mencoba lagi, tidak perlu daftar ulang.'],
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

  // "Sampai jumpa" card on the success screens (free confirmation and paid). Selection applicants
  // are not promised a seat, so their card shows only the event name.
  const fillConfirmationEventCard = (card, eventTitle) => {
    if (!card) return;
    card.hidden = !selectedEvent;
    if (!selectedEvent) return;
    const eventName = eventTitle || selectedEvent.name;
    card.querySelector('[data-confirmation-event-line]').textContent = selectedEvent.registrationMode === 'selection' ? eventName : `Sampai jumpa di ${eventName}`;
    card.querySelector('[data-confirmation-event-meta]').textContent = [selectedEvent.date, selectedEvent.location].filter(Boolean).join(' · ');
    const poster = card.querySelector('[data-confirmation-poster]');
    poster.hidden = !selectedEvent.image;
    if (selectedEvent.image) poster.src = selectedEvent.image;
  };

  const showPaymentLoadingState = () => {
    const stage = document.getElementById('paymentStage');
    if (!stage || !selectedEvent || selectedEvent.price <= 0) return;
    stage.classList.add('is-loading');
    stage.setAttribute('aria-busy', 'true');
    stage.querySelector('#paymentHeading').textContent = 'Menyiapkan QRIS...';
    stage.querySelector('.payment-intro').textContent = 'Mengirim data pendaftaran...';
    stage.querySelector('[data-payment-amount]').textContent = formatEventPrice(selectedEvent.price);
    stage.querySelector('[data-result-code]').textContent = 'Menunggu dibuat';
    stage.querySelector('[data-result-title]').textContent = selectedEvent.name;
    const orderRow = stage.querySelector('[data-result-order]');
    if (orderRow) orderRow.textContent = 'Menunggu dibuat';
    stage.querySelectorAll('[data-payment-state]').forEach((container) => { container.hidden = true; });
    const qr = stage.querySelector('.payment-qr-placeholder');
    const qrCode = qr?.querySelector('[data-payment-qr-code]');
    const qrImage = qr?.querySelector('[data-payment-qr]');
    if (qr) {
      qr.hidden = false;
      qr.setAttribute('aria-label', 'QRIS belum tersedia');
    }
    if (qrCode) {
      qrCode.hidden = true;
      qrCode.innerHTML = '';
    }
    if (qrImage) {
      qrImage.hidden = true;
      qrImage.removeAttribute('src');
      qrImage.alt = '';
    }
    stage.querySelector('.payment-countdown').hidden = false;
    const pendingState = stage.querySelector('[data-payment-state="payment_pending"]');
    if (pendingState) pendingState.hidden = false;
    stage.querySelector('.payment-guide').hidden = false;
    stage.querySelector('.payment-details').hidden = false;
    stage.querySelector('[data-payment-download]').hidden = false;
    stage.querySelector('[data-payment-check]').hidden = false;
    stage.querySelector('[data-payment-retry]').hidden = true;
    document.getElementById('freeRegistrationConfirmation').hidden = true;
    registrationContent?.classList.add('hidden');
    setRegistrationStep('payment');
    stage.hidden = false;
    focusRegistrationStep(stage);
  };

  const hidePaymentLoadingState = () => {
    const stage = document.getElementById('paymentStage');
    if (!stage?.classList.contains('is-loading')) return;
    stage.classList.remove('is-loading');
    stage.removeAttribute('aria-busy');
    stage.hidden = true;
    registrationContent?.classList.remove('hidden');
    setRegistrationStep('confirmation');
    focusRegistrationStep(registrationReview);
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
    stage.classList.remove('is-loading');
    stage.removeAttribute('aria-busy');
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
    const paidEventCard = stage.querySelector('[data-confirmation-event]');
    if (paidEventCard) {
      if (state === 'paid') fillConfirmationEventCard(paidEventCard, data.event_title);
      else paidEventCard.hidden = true;
    }
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

  // "Simpan ke kalender" for confirmed participants: a Google Calendar link and an .ics file
  // (with a reminder one day before) built from the selected event; nothing is sent anywhere.
  const calendarStamp = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const calendarEvent = (data) => {
    const start = new Date(selectedEvent?.start || '');
    if (!selectedEvent || Number.isNaN(start.getTime())) return null;
    const parsedEnd = new Date(selectedEvent.end || '');
    const end = Number.isNaN(parsedEnd.getTime()) || parsedEnd <= start ? new Date(start.getTime() + 2 * 3600e3) : parsedEnd;
    const groupUrl = safeWhatsAppGroupUrl(data?.whatsapp_group_url);
    const details = [
      data?.registration_code ? `Kode pendaftaran: ${data.registration_code}` : '',
      groupUrl ? `Grup WhatsApp: ${groupUrl}` : '',
      `Detail kegiatan: ${window.location.origin}/pendaftaran.html?event=${encodeURIComponent(selectedEvent.slug)}`
    ].filter(Boolean).join('\n');
    return {
      title: `${selectedEvent.name} · Kita Bahagia`, start, end, details,
      // normalizeScheduleEvent fills a missing location with a placeholder; keep it out of calendars.
      location: selectedEvent.location === 'Lokasi menyusul' ? '' : selectedEvent.location || '', uid: `${data?.registration_code || selectedEvent.slug}@kitabahagia`
    };
  };
  const downloadCalendarFile = (item) => {
    const text = (value) => String(value).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    // iCalendar lines are folded at 75 octets (UTF-8); continuation lines start with a space.
    const encoder = new TextEncoder();
    const fold = (line) => {
      const parts = [];
      let current = '';
      for (const character of line) {
        if (encoder.encode(current + character).length > (parts.length ? 74 : 75)) {
          parts.push(current);
          current = '';
        }
        current += character;
      }
      parts.push(current);
      return parts.join('\r\n ');
    };
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kita Bahagia//Pendaftaran//ID', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT', `UID:${item.uid}`, `DTSTAMP:${calendarStamp(new Date())}`,
      `DTSTART:${calendarStamp(item.start)}`, `DTEND:${calendarStamp(item.end)}`,
      `SUMMARY:${text(item.title)}`, `LOCATION:${text(item.location)}`, `DESCRIPTION:${text(item.details)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${text(`Besok: ${item.title}`)}`, 'TRIGGER:-P1D', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR'
    ];
    const url = URL.createObjectURL(new Blob([`${lines.map(fold).join('\r\n')}\r\n`], { type: 'text/calendar;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `kita-bahagia-${selectedEvent?.slug || 'kegiatan'}.ics`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const renderCalendar = (container, data) => {
    const block = container.querySelector('[data-calendar]');
    if (!block) return;
    const item = calendarEvent(data);
    block.hidden = !item;
    if (!item) return;
    const google = new URL('https://calendar.google.com/calendar/render');
    google.searchParams.set('action', 'TEMPLATE');
    google.searchParams.set('text', item.title);
    google.searchParams.set('dates', `${calendarStamp(item.start)}/${calendarStamp(item.end)}`);
    google.searchParams.set('details', item.details);
    if (item.location) google.searchParams.set('location', item.location);
    block.querySelector('[data-calendar-google]').href = google.href;
    block.querySelector('[data-calendar-ics]').onclick = () => downloadCalendarFile(item);
  };

  // "Ajak teman ikut" on the success screens: someone who just registered is the best person to invite friends.
  const renderShare = (container) => {
    const row = container.querySelector('[data-event-share]');
    if (!row) return;
    row.hidden = !selectedEvent;
    if (!selectedEvent) return;
    const shareUrl = `${window.location.origin}/pendaftaran.html?event=${encodeURIComponent(selectedEvent.slug)}`;
    row.querySelector('[data-event-share-whatsapp]').href = `https://wa.me/?text=${encodeURIComponent(`Aku sudah daftar ${selectedEvent.name} di Kita Bahagia, ikut yuk: ${shareUrl}`)}`;
    const copyButton = row.querySelector('[data-event-share-copy]');
    copyButton.onclick = async () => {
      try {
        await navigator.clipboard.writeText(shareUrl);
        copyButton.textContent = 'Tersalin';
      } catch {
        copyButton.textContent = 'Gagal menyalin';
      }
      setTimeout(() => { copyButton.textContent = 'Salin link'; }, 2000);
    };
  };

  const renderOnboarding = (container, data) => {
    if (!container) return;
    const copy = container.querySelector('[data-onboarding-copy]');
    const link = container.querySelector('[data-whatsapp-group]');
    const groupUrl = safeWhatsAppGroupUrl(data?.whatsapp_group_url);
    container.hidden = false;
    renderCalendar(container, data);
    renderShare(container);
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

  // Confirmed and "applied" registrations get an email; show where it went so a typo is noticed.
  const renderEmailNote = (container, data) => {
    const note = container?.querySelector('[data-email-note]');
    if (!note) return;
    note.hidden = !['confirmed', 'applied'].includes(data?.registration_status);
    if (note.hidden) return;
    const email = registrationForm ? String(new FormData(registrationForm).get('email') || '').trim() : '';
    const address = document.createElement('strong');
    address.textContent = email;
    note.replaceChildren(...(email ? ['Email konfirmasi sudah dikirim ke ', address, '.'] : ['Email konfirmasi sudah dikirim ke email yang kamu daftarkan.']),
      ' Belum masuk dalam beberapa menit? Cek folder Promosi atau Spam.');
  };

  const showConfirmedRegistration = (data) => {
    stopPaymentMonitoring();
    renderPaymentState('paid', data);
    renderEmailNote(document.getElementById('paymentStage'), { registration_status: 'confirmed', ...data });
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
    fillConfirmationEventCard(resultStage.querySelector('[data-confirmation-event]'), data.event_title);
    renderEmailNote(resultStage, data);
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
    stage.querySelector('.payment-intro').textContent = 'Data pendaftaranmu tetap tersimpan. Kalau kamu sudah membayar, jangan bayar lagi. Periksa koneksi internet, lalu coba periksa status lagi.';
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
  // Custom "Pilih file" pickers: show the chosen name; call again after clearing an input in code.
  const syncFilePickerNames = () => document.querySelectorAll('.file-picker').forEach((picker) => {
    const file = picker.querySelector('.file-picker-input')?.files?.[0];
    const name = picker.querySelector('[data-file-name]');
    if (!name) return;
    name.textContent = file ? file.name : 'Belum ada file';
    name.classList.toggle('has-file', Boolean(file));
  });
  document.querySelectorAll('.file-picker-input').forEach((input) => input.addEventListener('change', syncFilePickerNames));
  registrationForm.addEventListener('reset', () => setTimeout(syncFilePickerNames));
  const cvFieldsShown = () => isFreeSelectionEvent() && Boolean(selectedEvent?.cvRequested);
  const portfolioHint = document.getElementById('portfolioUrlHint');
  const defaultPortfolioHint = portfolioHint?.textContent || '';
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
      const showCv = cvFieldsShown();
      cvField.hidden = !showCv;
      portfolioField.hidden = !showCv;
      if (portfolioHint) portfolioHint.textContent = selectedEvent?.cvNote || defaultPortfolioHint;
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
    syncFilePickerNames();
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
    // The location name itself links to Google Maps (admin link, else a search), and the
    // "Lokasi" section in the event details gets a small map that loads only when opened.
    const hasLocation = selectedEvent.location && selectedEvent.location !== 'Lokasi menyusul';
    const mapsUrl = selectedEvent.locationUrl
      || (hasLocation ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedEvent.location)}` : null);
    if (mapsUrl) {
      const locationLink = document.createElement('a');
      locationLink.className = 'event-location-link';
      locationLink.href = mapsUrl;
      locationLink.target = '_blank';
      locationLink.rel = 'noopener noreferrer';
      locationLink.append(document.createTextNode(`${selectedEvent.location} `));
      const arrow = document.createElement('span');
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '↗';
      locationLink.append(arrow);
      document.getElementById('eventLocation')?.replaceChildren(locationLink);
    }
    const locationSection = document.getElementById('eventLocationSection');
    if (locationSection) {
      locationSection.hidden = !hasLocation;
      document.getElementById('eventLocationNav')?.toggleAttribute('hidden', !hasLocation);
      if (hasLocation) {
        setText('eventLocationText', selectedEvent.location);
        locationSection.querySelector('[data-event-map-open]').href = mapsUrl;
        const map = locationSection.querySelector('[data-event-map]');
        const loadMap = () => {
          if (map.querySelector('iframe')) return;
          const frame = document.createElement('iframe');
          frame.src = `https://maps.google.com/maps?q=${encodeURIComponent(selectedEvent.location)}&z=15&output=embed`;
          frame.title = `Peta lokasi ${selectedEvent.location}`;
          frame.loading = 'lazy';
          frame.referrerPolicy = 'no-referrer-when-downgrade';
          map.append(frame);
        };
        const disclosure = document.querySelector('.registration-event-disclosure');
        if (!disclosure || disclosure.open) loadMap();
        else disclosure.addEventListener('toggle', () => { if (disclosure.open) loadMap(); }, { once: true });
      }
    }
    // The status line must not say "dibuka" while the form below is closed or not open yet.
    const statusReason = eventRegistrationAvailability(selectedEvent).reason;
    const statusText = statusReason === 'past' ? 'Selesai'
      : statusReason === 'not_yet' ? 'Pendaftaran belum dibuka'
      : statusReason === 'applicants_full' ? 'Pendaftaran ditutup' : selectedEvent.status;
    // A finished event shows no seat count.
    setText('eventStatus', statusReason === 'past' || statusText === selectedEvent.capacity
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
    // Selection applicants should read the requirements before the form, so start with details open.
    const eventDisclosure = document.querySelector('.registration-event-disclosure');
    if (eventDisclosure && isFreeSelectionEvent()) eventDisclosure.open = true;

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
      const showWindow = selectedEvent.price > 0 && Number.isInteger(minutes) && minutes > 0
        && eventRegistrationAvailability(selectedEvent).reason !== 'past';
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
    const eventGallery = document.getElementById('eventGallery');
    if (eventGallery) {
      if (availability.reason === 'past') {
        renderEventGallery(eventGallery, {
          title: selectedEvent.name, documentationUrl: selectedEvent.documentationUrl, photos: selectedEvent.documentationPhotos
        });
      } else {
        eventGallery.hidden = true;
      }
    }
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
      // Each event is its own page for search engines, not a copy of /pendaftaran.
      document.querySelector('link[rel="canonical"]')?.setAttribute('href', `https://kitabahagia.id/pendaftaran?event=${encodeURIComponent(event.slug)}`);
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
      age: Number.parseInt(String(formData.get('age') || ''), 10) || null,
      referral_source: String(formData.get('referral_source') || '') || null,
      social_account: String(formData.get('social_account') || '').trim() || null,
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
      if (cvFieldsShown()) payload.portfolio_url = String(formData.get('portfolio_url') || '').trim() || null;
      const proof = await prepareInstagramProof(formData.get('instagram_proof'));
      const cv = cvFieldsShown() ? await prepareCv(formData.get('cv')) : null;
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
    RATE_LIMITED: 'Terlalu banyak percobaan pendaftaran dari jaringan ini. Coba lagi beberapa menit lagi.',
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
    SERVER_ERROR: 'Pendaftaran belum terkirim karena gangguan jaringan atau layanan. Data yang kamu isi tidak hilang, jadi cukup kirim lagi. Kalau kemudian muncul pesan sudah terdaftar, berarti pendaftaranmu tadi sudah masuk.'
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
    setDataText('[data-review-age]', String(formData.get('age') || '').trim(), registrationReview);
    setDataText('[data-review-social]', String(formData.get('social_account') || '').trim(), registrationReview);
    setDataText('[data-review-referral]', document.getElementById('referralSource')?.selectedOptions[0]?.textContent || '', registrationReview);
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
      portfolioReview.hidden = !cvFieldsShown() || !items.length;
      setDataText('[data-review-portfolio-value]', items.join(' · '), registrationReview);
    }
    setDataText('[data-review-event-title]', selectedEvent.name, registrationReview);
    setDataText('[data-review-event-date]', `${selectedEvent.date} · ${selectedEvent.time}`, registrationReview);
    setDataText('[data-review-event-location]', selectedEvent.location, registrationReview);
    setDataText('[data-review-event-price]', price, registrationReview);
    // Say what happens right after the click, per registration mode.
    const announcementAt = Date.parse(selectedEvent.announcementAt || '');
    setDataText('[data-review-consequence]', selectedEvent.price > 0
      ? 'Setelah melanjutkan, QRIS akan dibuat dan slotmu ditahan sementara sampai batas waktu pembayaran. Jika belum dibayar sampai batas itu, slot kembali tersedia untuk peserta lain.'
      : isSelectionEvent()
        ? `Setelah dikirim, pendaftaranmu masuk tahap seleksi dan belum berarti terpilih. ${Number.isFinite(announcementAt)
          ? `Hasilnya diumumkan ${announcementDateFormatter.format(new Date(announcementAt))} lewat WhatsApp dan halaman Cek status.`
          : 'Hasilnya diumumkan lewat WhatsApp dan halaman Cek status.'}`
        : 'Setelah dikonfirmasi, tempatmu langsung aman. Info selanjutnya dikirim tim Kita Bahagia lewat WhatsApp.', registrationReview);
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

  // KB-styled dropdown for the form's <select> (same look as the admin dropdown). The native
  // select stays in the form as the value and validation source.
  const enhanceFormSelect = (select) => {
    const wrap = document.createElement('div');
    wrap.className = 'kb-select';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'kb-select-button';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    const labelText = document.querySelector(`label[for="${select.id}"]`)?.textContent.trim();
    if (labelText) button.setAttribute('aria-label', labelText);
    const list = document.createElement('ul');
    list.className = 'kb-select-list';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    select.after(wrap);
    wrap.append(select, button, list);
    select.classList.add('kb-select-native');
    select.tabIndex = -1;
    const options = () => [...select.options].map((option, index) => ({ option, index })).filter(({ option }) => !option.disabled);
    const sync = () => {
      const option = select.options[select.selectedIndex];
      button.textContent = option?.textContent || '';
      button.classList.toggle('is-placeholder', !select.value);
      if (select.value) button.removeAttribute('aria-invalid');
    };
    const close = (focus = false) => {
      list.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      if (focus) button.focus();
    };
    const highlight = (index) => [...list.children].forEach((item) => item.classList.toggle('is-active', Number(item.dataset.index) === index));
    const open = () => {
      list.replaceChildren(...options().map(({ option, index }) => {
        const item = document.createElement('li');
        item.setAttribute('role', 'option');
        item.dataset.index = String(index);
        item.textContent = option.textContent;
        item.setAttribute('aria-selected', String(option.selected && Boolean(select.value)));
        return item;
      }));
      list.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      highlight(select.value ? select.selectedIndex : options()[0]?.index);
    };
    const pick = (index) => {
      if (select.selectedIndex !== index) {
        select.selectedIndex = index;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      sync();
      close(true);
    };
    const activeIndex = () => Number(list.querySelector('.is-active')?.dataset.index ?? -1);
    button.addEventListener('click', () => (list.hidden ? open() : close()));
    button.addEventListener('keydown', (event) => {
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        if (list.hidden) { open(); return; }
        const indexes = options().map(({ index }) => index);
        const position = indexes.indexOf(activeIndex());
        const next = indexes[Math.min(indexes.length - 1, Math.max(0, position + (event.key === 'ArrowDown' ? 1 : -1)))];
        highlight(next);
      } else if (['Enter', ' '].includes(event.key) && !list.hidden) {
        event.preventDefault();
        if (activeIndex() >= 0) pick(activeIndex());
      } else if (event.key === 'Escape' && !list.hidden) {
        event.preventDefault();
        close(true);
      } else if (event.key === 'Tab') {
        close();
      }
    });
    list.addEventListener('mousedown', (event) => event.preventDefault());
    list.addEventListener('click', (event) => {
      const item = event.target.closest('[role=option]');
      if (item) pick(Number(item.dataset.index));
    });
    document.addEventListener('click', (event) => { if (!list.hidden && !wrap.contains(event.target)) close(); });
    // The browser's "please select" check focuses the hidden select: hand focus to the button.
    select.addEventListener('focus', () => button.focus());
    select.addEventListener('invalid', () => button.setAttribute('aria-invalid', 'true'));
    select.addEventListener('change', sync);
    select.form?.addEventListener('reset', () => setTimeout(sync));
    sync();
  };
  registrationForm.querySelectorAll('select').forEach(enhanceFormSelect);

  const telephoneInput = document.getElementById('telepon');
  // Optional "ingat data saya": prefills the next registration on this device only; never sent to the server.
  const profileStorageKey = 'kb_volunteer_profile';
  const profileFields = ['nama', 'telepon', 'email', 'domicile', 'institution', 'age', 'socialAccount'];
  const rememberProfileInput = document.getElementById('rememberProfile');
  try {
    const saved = JSON.parse(localStorage.getItem(profileStorageKey) || 'null');
    if (saved && typeof saved === 'object') {
      profileFields.forEach((id) => {
        const input = document.getElementById(id);
        if (input && !input.value && typeof saved[id] === 'string') input.value = saved[id];
      });
      if (rememberProfileInput) rememberProfileInput.checked = true;
    }
  } catch {
    // Storage can be unavailable (private mode); the form still works without it.
  }
  const storeProfile = () => {
    try {
      if (rememberProfileInput?.checked) {
        localStorage.setItem(profileStorageKey, JSON.stringify(Object.fromEntries(
          profileFields.map((id) => [id, document.getElementById(id)?.value.trim() || ''])
        )));
      } else {
        localStorage.removeItem(profileStorageKey);
      }
    } catch {
      // Ignore storage errors; remembering is a convenience only.
    }
  };
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
  // Flag a wrong number as soon as the field is left, not only on submit (an empty field waits for submit).
  telephoneInput?.addEventListener('blur', () => {
    if (telephoneInput.value.trim()) validatePhoneField();
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
    storeProfile();
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
    const isPaidEvent = selectedEvent.price > 0;
    if (isPaidEvent) showPaymentLoadingState();

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
      if (isPaidEvent) hidePaymentLoadingState();
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

// sertifikat.html?k=<code>: the link in the certificate QR and email. The PDF link is
// signed for 10 minutes, so "Unduh PDF" asks for a fresh one on every click.
const certificateCheck = document.querySelector('.certificate-check');
if (certificateCheck) {
  const message = document.getElementById('certificateMessage');
  const result = document.getElementById('certificateResult');
  const code = new URLSearchParams(window.location.search).get('k') || '';
  const lookup = async () => {
    const response = await fetch(`${SUPABASE_FUNCTIONS_BASE_URL}/public-certificate?k=${encodeURIComponent(code)}`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000)
    });
    if (response.status === 404) return null;
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.certificate) throw new Error('lookup failed');
    return payload.certificate;
  };
  const dateText = (certificate) => {
    const start = eventDateFormatter.format(new Date(`${certificate.event_date}T12:00:00+07:00`));
    if (!certificate.event_end_at) return start;
    const end = eventDateFormatter.format(new Date(certificate.event_end_at));
    return end === start ? start : `${start} – ${end}`;
  };
  const show = (certificate) => {
    const set = (key, value) => { result.querySelector(`[data-certificate-${key}]`).textContent = value; };
    set('name', certificate.recipient_name);
    set('role', certificate.role);
    set('event', certificate.event_title);
    set('date', dateText(certificate));
    set('number', certificate.certificate_number);
    set('issued', eventDateFormatter.format(new Date(certificate.issued_at)));
    message.textContent = '';
    message.hidden = true;
    result.hidden = false;
  };
  const notFound = 'Sertifikat tidak ditemukan. Pastikan link atau QR-nya utuh. Kalau yakin sertifikatmu asli, hubungi Kita Bahagia lewat halaman Kontak.';
  const failed = 'Sertifikat belum dapat diperiksa. Periksa koneksi lalu muat ulang halaman ini.';
  if (!/^[A-Za-z0-9]{20,40}$/.test(code)) {
    message.textContent = notFound;
  } else {
    lookup()
      .then((certificate) => (certificate ? show(certificate) : (message.textContent = notFound)))
      .catch(() => { message.textContent = failed; });
  }
  result.querySelector('[data-certificate-download]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const certificate = await lookup();
      if (!certificate?.pdf_url) throw new Error('no pdf');
      window.location.href = certificate.pdf_url;
    } catch {
      message.hidden = false;
      message.textContent = 'PDF belum dapat diunduh. Coba lagi sebentar lagi.';
    } finally {
      button.disabled = false;
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
