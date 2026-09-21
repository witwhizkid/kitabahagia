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
const PUBLIC_EVENTS_CONFIG = Object.freeze({ demo: true });

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
  const capacity = remainingCapacity === null
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
    time: end
      ? `${eventTimeFormatter.format(start)}\u2013${eventTimeFormatter.format(end)} WIB`
      : `${eventTimeFormatter.format(start)} WIB`,
    location: event.location || 'Lokasi menyusul',
    status: statusLabels[statusKey] || event.status || 'Status belum tersedia',
    statusKey,
    capacity,
    price: Number(event.price) || 0,
    image: event.image_url || '',
    imageAlt: event.image_alt || `Dokumentasi ${event.title}`,
    registrationDeadline: event.registration_deadline || null,
    deadlineLabel: formatEventDeadline(event.registration_deadline)
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
    remainingCapacity: event.remaining_capacity,
    registrationDeadline: event.registration_deadline || null
  };
};

const eventRegistrationLink = (event, className, label) => `<a class="${className}"
  data-registration-link data-event-slug="${escapeHTML(event.slug)}"
  href="pendaftaran.html?event=${encodeURIComponent(event.slug)}">${label}</a>`;

const renderHomepageEvents = async () => {
  const list = document.querySelector('[data-upcoming-list]');
  const empty = document.querySelector('[data-upcoming-empty]');
  if (!list || !empty) return;

  const setState = (title, message) => {
    list.hidden = true;
    empty.querySelector('h3')?.replaceChildren(document.createTextNode(title));
    empty.querySelector('p')?.replaceChildren(document.createTextNode(message));
    empty.hidden = false;
  };

  setState('Memuat kegiatan terdekat\u2026', 'Mengambil agenda terbaru untuk kamu.');

  let events;
  try {
    events = (await fetchPublicEvents({ limit: 3 }))
      .map(normalizeScheduleEvent)
      .filter(Boolean)
      .sort((a, b) => new Date(a.start) - new Date(b.start))
      .slice(0, 3);
  } catch (error) {
    console.error('Kegiatan terdekat gagal dimuat', error);
    setState('Kegiatan belum dapat dimuat.', 'Periksa koneksi lalu muat ulang halaman ini.');
    return;
  }

  if (!events.length) {
    setState('Belum ada kegiatan dalam waktu dekat.', 'Jadwal kegiatan berikutnya akan segera hadir. Pantau halaman jadwal untuk informasi terbaru.');
    return;
  }

  const eventMarkup = (event, featured = false) => `<article class="home-upcoming-event${featured ? ' featured' : ''} reveal visible" data-upcoming-event>
    <figure><img src="${escapeHTML(event.image)}" alt="${escapeHTML(event.imageAlt)}"></figure>
    <div class="home-upcoming-event-copy">
      <div class="home-upcoming-event-topline"><span>${escapeHTML(event.category)}</span><span>${escapeHTML(event.status)}</span></div>
      <h3>${escapeHTML(event.name)}</h3>
      <dl class="home-upcoming-meta">
        <div><dt>Tanggal &amp; waktu</dt><dd>${escapeHTML(event.date)} · ${escapeHTML(event.time)}</dd></div>
        <div><dt>Lokasi</dt><dd>${escapeHTML(event.location)}</dd></div>
        <div><dt>Harga</dt><dd>${formatEventPrice(event.price)}</dd></div>
      </dl>
      ${eventRegistrationLink(event, 'home-upcoming-register', 'Daftar sekarang &rarr;')}
    </div>
  </article>`;

  list.innerHTML = `${eventMarkup(events[0], true)}<div class="home-upcoming-supporting">
    ${events.slice(1).map((event) => eventMarkup(event)).join('')}</div>`;
  list.hidden = false;
  empty.hidden = true;
};

const renderScheduleEvents = async () => {
  const grid = document.getElementById('scheduleGrid');
  const featuredSection = document.querySelector('[data-schedule-featured]');
  const featured = document.getElementById('scheduleFeatured');
  const empty = document.getElementById('scheduleEmpty');
  const count = document.getElementById('scheduleCount');
  if (!grid || !featuredSection || !featured) return;

  const setMessage = (title, detail) => {
    featuredSection.hidden = true;
    grid.replaceChildren();
    if (empty) {
      empty.innerHTML = `<strong>${escapeHTML(title)}</strong><span>${escapeHTML(detail)}</span>`;
      empty.classList.remove('hidden');
    }
  };

  if (count) count.textContent = 'Memuat kegiatan\u2026';
  setMessage('Memuat jadwal kegiatan\u2026', 'Mohon tunggu sebentar.');

  let scheduleEvents;
  try {
    scheduleEvents = (await fetchPublicEvents())
      .map(normalizeScheduleEvent)
      .filter(Boolean)
      .sort((a, b) => new Date(a.start) - new Date(b.start));
  } catch (error) {
    console.error('Jadwal kegiatan gagal dimuat', error);
    if (count) count.textContent = 'Jadwal gagal dimuat';
    setMessage('Jadwal belum dapat dimuat.', 'Periksa koneksi lalu muat ulang halaman ini.');
    return;
  }

  if (!scheduleEvents.length) {
    if (count) count.textContent = 'Menampilkan 0 kegiatan';
    setMessage('Belum ada kegiatan yang tersedia.', 'Silakan cek kembali untuk agenda berikutnya.');
    return;
  }

  const eventImage = (event, className) => `<figure class="${className}${event.image ? '' : ' is-empty'}">${event.image
    ? `<img src="${escapeHTML(event.image)}" alt="${escapeHTML(event.imageAlt)}" loading="lazy" decoding="async">`
    : ''}</figure>`;
  const eventMeta = (event) => `<dl class="schedule-meta">
    <div><dt>Tanggal &amp; waktu</dt><dd>${escapeHTML(event.date)} · ${escapeHTML(event.time)}</dd></div>
    <div><dt>Lokasi</dt><dd>${escapeHTML(event.location)}</dd></div>
    <div><dt>Harga</dt><dd>${formatEventPrice(event.price)}</dd></div>
  </dl>`;
  const eventTopline = (event) => `<div class="schedule-event-head">
    <span class="schedule-category">${escapeHTML(event.category)}</span>
    <span class="status-label ${event.statusKey === 'full' || event.statusKey === 'closed' ? 'limited' : 'available'}">${escapeHTML(event.status)}</span>
  </div>`;

  const now = Date.now();
  const urgencyWindow = 14 * 24 * 60 * 60 * 1000;
  const urgentEvents = scheduleEvents.filter((event) => {
    if (!event.registrationDeadline || event.statusKey !== 'open') return false;
    const remaining = new Date(event.registrationDeadline).getTime() - now;
    return remaining > 0 && remaining <= urgencyWindow;
  }).sort((a, b) => new Date(a.registrationDeadline) - new Date(b.registrationDeadline));

  if (urgentEvents.length) {
    featured.innerHTML = urgentEvents.map((event) => `<article class="schedule-urgent-card reveal visible">
      ${eventImage(event, 'schedule-urgent-image')}
      <div class="schedule-urgent-content">
        ${eventTopline(event)}
        <h3>${escapeHTML(event.name)}</h3>
        <p>${escapeHTML(event.description)}</p>
        <p class="schedule-deadline"><span>Batas pendaftaran</span><strong>${escapeHTML(event.deadlineLabel)}</strong></p>
        ${eventMeta(event)}
        ${eventRegistrationLink(event, 'schedule-register', 'Lihat kegiatan <span aria-hidden="true">→</span>')}
      </div>
    </article>`).join('');
    featuredSection.hidden = false;
  } else {
    featured.replaceChildren();
    featuredSection.hidden = true;
  }

  grid.innerHTML = scheduleEvents.map((event) => `<article class="schedule-card reveal visible" data-category="${escapeHTML(event.categoryKey)}" data-date="${escapeHTML(event.start)}" data-search="${escapeHTML(`${event.name} ${event.location} ${event.category}`.toLocaleLowerCase('id-ID'))}">
    ${eventImage(event, 'schedule-card-image')}
    <div class="schedule-card-content">
    <div class="schedule-event">
      ${eventTopline(event)}
      <h2>${escapeHTML(event.name)}</h2>
      <p>${escapeHTML(event.description)}</p>
    </div>
    ${eventMeta(event)}
    <div class="schedule-card-footer"><strong>${escapeHTML(event.capacity)}</strong>${eventRegistrationLink(event, 'schedule-register', 'Lihat kegiatan <span aria-hidden="true">→</span>')}</div>
    </div>
  </article>`).join('');
  if (count) count.textContent = `Menampilkan ${scheduleEvents.length} kegiatan`;
  empty?.classList.add('hidden');

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
    timer.innerHTML = "<div style=\"grid-column:1/-1\"><strong>Belum ada agenda terdekat</strong><span>Silakan cek kembali jadwal berikutnya.</span></div>";
    return;
  }

  const nameEl = document.getElementById("nextEventName");
  const metaEl = document.getElementById("nextEventMeta");
  if (nameEl) nameEl.textContent = nextEvent.name;
  if (metaEl) metaEl.textContent = nextEvent.meta;

  const update = () => {
    const diff = nextEvent.date.getTime() - Date.now();
    if (diff <= 0) {
      timer.innerHTML = "<div style=\"grid-column:1/-1\"><strong>Kegiatan sedang berlangsung 🎉</strong><span>Semoga harinya berjalan menyenangkan.</span></div>";
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

const registrationForm = document.querySelector('[data-registration-form]');

if (registrationForm) {
  const params = new URLSearchParams(window.location.search);
  const eventSlug = (params.get('event') || '').trim().toLowerCase();
  let selectedEvent = null;
  const registrationContent = document.getElementById('registrationContent');
  const eventFallback = document.getElementById('eventFallback');
  const selectedEventIntro = document.getElementById('selectedEventIntro');
  const paymentStates = {
    pending: ['Selesaikan pembayaran', 'Pendaftaranmu sudah tercatat. Selesaikan pembayaran untuk mengamankan tempatmu.'],
    processing: ['Pembayaran sedang diverifikasi', 'Kami sedang memastikan pembayaranmu. Halaman ini akan diperbarui setelah statusnya terkonfirmasi.'],
    paid: ['Pembayaran berhasil', 'Tempatmu sudah dikonfirmasi.'],
    expired: ['Waktu pembayaran habis', 'QRIS sebelumnya sudah tidak dapat digunakan. Pendaftaranmu tetap tercatat.'],
    failed: ['Pembayaran belum berhasil', 'Pembayaran tidak berhasil diselesaikan. Pendaftaranmu tetap tercatat.'],
    refunded: ['Pembayaran dikembalikan', 'Pembayaran ini sudah dikembalikan. Hubungi tim Kita Bahagia bila perlu bantuan.']
  };
  const paymentStatusCopy = {
    pending: ['Menunggu pembayaran', 'Selesaikan pembayaran melalui QRIS sebelum waktu pembayaran habis.'],
    processing: ['Pembayaran sedang diperiksa', 'Pembayaranmu sedang diperiksa. Tidak perlu melakukan pembayaran ulang.'],
    paid: ['Pembayaran berhasil', 'Pendaftaranmu sudah dikonfirmasi.'],
    expired: ['Waktu pembayaran habis', 'QRIS sebelumnya sudah tidak dapat digunakan.'],
    failed: ['Pembayaran belum berhasil', 'Pembayaran tidak berhasil diselesaikan.'],
    refunded: ['Pembayaran dikembalikan', 'Pembayaran ini sudah dikembalikan.']
  };
  const requestedDemo = ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? params.get('payment_demo') : null;
  const paymentDemoStates = ['pending', 'processing', 'paid', 'expired', 'failed'];
  const paymentDemo = paymentDemoStates.includes(requestedDemo) ? requestedDemo : null;

  let countdownTimer = null;
  let paymentPollTimer = null;
  let paymentPollStopped = false;

  const stopPaymentMonitoring = () => {
    window.clearInterval(countdownTimer);
    window.clearTimeout(paymentPollTimer);
    countdownTimer = null;
    paymentPollTimer = null;
    paymentPollStopped = true;
  };

  const formatPaymentCountdown = (milliseconds) => {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
  };

  const updatePaymentCountdown = (expiresAt, onExpired) => {
    const countdown = document.querySelector('#paymentStage .payment-countdown');
    const countdownValue = countdown?.querySelector('strong');
    const expiry = new Date(expiresAt).getTime();
    if (!countdown || !countdownValue || Number.isNaN(expiry)) return;
    countdown.hidden = false;
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

  const renderPaymentState = (state, data) => {
    const stage = document.getElementById('paymentStage');
    if (!stage || !Object.hasOwn(paymentStates, state)) return;
    if (['paid', 'expired', 'failed'].includes(state)) stopPaymentMonitoring();
    const [heading, body] = paymentStates[state];
    Object.keys(paymentStates).forEach((key) => stage.classList.toggle(`payment_${key}`, key === state));
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
    stage.querySelector('.payment-primary > p').textContent = body;
    stage.querySelector('.payment-details dl > div:last-child dd').textContent = state === 'paid'
      ? 'Pendaftaran kegiatan · pembayaran dikonfirmasi' : `Pendaftaran kegiatan · ${heading.toLowerCase()}`;
    const qr = stage.querySelector('.payment-qr-placeholder');
    const qrImage = qr?.querySelector('[data-payment-qr]');
    const hasQr = typeof data.qr_url === 'string' && /^https:\/\//.test(data.qr_url);
    qr.hidden = !hasQr || !['pending', 'processing'].includes(state);
    if (qrImage && hasQr) {
      qrImage.src = data.qr_url;
      qrImage.alt = `QRIS pembayaran ${formatEventPrice(data.amount)} untuk ${data.event_title || selectedEvent?.name || 'kegiatan Kita Bahagia'}`;
    }
    qr.setAttribute('aria-label', hasQr ? 'QRIS pembayaran' : 'QRIS belum tersedia');
    stage.querySelector('.payment-countdown').hidden = true;
    if (paymentDemo && state === 'pending') {
      stage.querySelector('#paymentHeading').textContent = 'Simulasi pembayaran';
      stage.querySelector('.payment-primary > p').textContent = 'Pendaftaran demo tercatat. Gunakan tombol simulasi di bawah untuk mencoba hasil pembayaran berhasil. Tidak ada uang yang ditagih.';
      stage.querySelector('[data-payment-state="payment_pending"] strong').textContent = 'Menunggu simulasi';
      stage.querySelector('[data-payment-state="payment_pending"] p').textContent = 'Ini bukan tagihan atau reservasi kegiatan sungguhan.';
    }
    document.getElementById('freeRegistrationConfirmation').hidden = true;
    const orderRow = stage.querySelector('[data-result-order]');
    if (orderRow) orderRow.textContent = data.order_id || 'Menunggu dibuat';
    stage.hidden = false;
    stage.focus();
    if (state === 'pending' && data.expires_at) {
      updatePaymentCountdown(data.expires_at, () => renderPaymentState('expired', { ...data, payment_status: 'expired' }));
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
    const response = await fetch(REGISTRATION_CONFIG.paymentStatusEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ registration_code: registration.registration_code, email }),
      signal: AbortSignal.timeout(10000)
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.payment_status) throw new Error('STATUS_ERROR');
    return result;
  };

  const createPayment = async (registration) => {
    const email = String(new FormData(registrationForm).get('email') || '').trim().toLowerCase();
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
    return { ...registration, ...result, event_title: registration.event_title || selectedEvent.name };
  };

  const showConfirmedRegistration = (data) => {
    stopPaymentMonitoring();
    renderPaymentState('paid', data);
    renderOnboarding(document.querySelector('#paymentStage [data-registration-onboarding]'), data);
    document.getElementById('paymentStage')?.focus();
  };

  const pollPaymentStatus = (registration, email) => {
    paymentPollStopped = false;
    const poll = async () => {
      if (paymentPollStopped) return;
      try {
        const result = await fetchRegistrationStatus(registration, email);
        if (result.payment_status === 'paid' && result.registration_status === 'confirmed') {
          showConfirmedRegistration({ ...registration, ...result });
          return;
        }
        if (['expired', 'failed', 'refunded'].includes(result.payment_status)) {
          renderPaymentState(result.payment_status, { ...registration, ...result });
          return;
        }
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
    if (selectedEventIntro) selectedEventIntro.textContent = intro;
    const heading = eventFallback?.querySelector('h2');
    const paragraph = eventFallback?.querySelector('p');
    if (heading) heading.textContent = title;
    if (paragraph) paragraph.textContent = message;
    eventFallback?.classList.remove('hidden');
  };

  const renderSelectedEvent = () => {
    if (!selectedEvent) return;
    const setText = (id, value) => {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    };

    if (selectedEventIntro) selectedEventIntro.textContent = selectedEvent.name;
    setText('eventName', selectedEvent.name);
    setText('eventCategory', selectedEvent.category);
    setText('eventDate', selectedEvent.date);
    setText('eventTime', selectedEvent.time);
    setText('eventLocation', selectedEvent.location);
    setText('eventStatus', selectedEvent.status === selectedEvent.capacity
      ? selectedEvent.status
      : `${selectedEvent.status} · ${selectedEvent.capacity}`);

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

    const renderEventList = (sectionId, listId, navId, items) => {
      const section = document.getElementById(sectionId);
      const list = document.getElementById(listId);
      const navLink = document.getElementById(navId);
      if (!section || !list) return;
      const entries = Array.isArray(items) ? items.filter(Boolean) : [];
      list.replaceChildren(...entries.map((item) => {
        const entry = document.createElement('li');
        entry.textContent = item;
        return entry;
      }));
      section.hidden = entries.length === 0;
      if (navLink) navLink.hidden = entries.length === 0;
    };
    renderEventList('eventActivitiesSection', 'eventActivities', 'eventActivitiesNav', selectedEvent.activities);
    renderEventList('eventBenefitsSection', 'eventBenefits', 'eventBenefitsNav', selectedEvent.benefits);

    const eventNameInput = document.getElementById('kegiatan');
    const eventSlugInput = document.getElementById('eventSlug');
    if (eventNameInput) eventNameInput.value = selectedEvent.name;
    if (eventSlugInput) eventSlugInput.value = selectedEvent.slug;

    if (selectedEvent.price !== null && selectedEvent.price !== undefined) {
      setText('eventPrice', formatEventPrice(selectedEvent.price));
      document.getElementById('eventPriceRow')?.classList.remove('hidden');
    }

    eventFallback?.classList.add('hidden');
    registrationContent?.classList.remove('hidden');
    const submitButton = registrationForm.querySelector('[type="submit"]');
    const availabilityNote = document.getElementById('registrationAvailabilityNote');
    const availabilityEnd = new Date(selectedEvent.end || selectedEvent.start).getTime();
    const registrationAvailable = Boolean(REGISTRATION_CONFIG.registrationEndpoint)
      && !Number.isNaN(availabilityEnd)
      && availabilityEnd >= Date.now()
      && !['closed', 'cancelled', 'completed', 'full'].includes(selectedEvent.statusKey);
    if (submitButton) {
      submitButton.disabled = !registrationAvailable;
      submitButton.textContent = 'Kirim pendaftaran';
    }
    if (availabilityNote) {
      availabilityNote.textContent = registrationAvailable
        ? 'Pastikan data sudah benar sebelum mengirim pendaftaran.'
        : 'Pendaftaran belum tersedia. Hubungi admin untuk informasi kegiatan berikutnya.';
    }
  };

  const initializeRegistrationEvent = async () => {
    if (!eventSlug) {
      showEventFallback(
        'Kegiatan tidak ditemukan',
        'Tautan pendaftaran ini tidak memuat kegiatan yang valid. Silakan kembali ke jadwal dan pilih kegiatan yang tersedia.',
        'Kegiatan belum dipilih'
      );
      return;
    }

    showEventFallback('Memuat kegiatan\u2026', 'Mengambil detail kegiatan yang dipilih.', 'Memuat kegiatan\u2026');
    try {
      const events = await fetchPublicEvents({ slug: eventSlug });
      if (!events.length) {
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
    } catch (error) {
      console.error('Detail kegiatan gagal dimuat', error);
      showEventFallback(
        'Kegiatan belum dapat dimuat',
        'Periksa koneksi lalu muat ulang halaman ini, atau kembali ke jadwal kegiatan.'
      );
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
      reason: String(formData.get('alasan') || '').trim(),
      notes: String(formData.get('catatan') || '').trim() || null,
      consent: formData.get('consent') !== null
    };
    const response = await fetch(REGISTRATION_CONFIG.registrationEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
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
    INVALID_REQUEST: 'Data pendaftaran belum valid. Periksa kembali isian kamu.',
    EVENT_NOT_FOUND: 'Kegiatan ini belum ditemukan di sistem pendaftaran.',
    EVENT_NOT_OPEN: 'Pendaftaran untuk kegiatan ini sedang tidak dibuka.',
    REGISTRATION_CLOSED: 'Batas waktu pendaftaran kegiatan ini sudah berakhir.',
    EVENT_FULL: 'Kapasitas kegiatan ini sudah penuh.',
    PAYMENT_IN_PROGRESS: 'Pembayaran sedang disiapkan. Muat ulang halaman ini beberapa saat lagi untuk melanjutkan.',
    PAYMENT_AWAITING_CONFIRMATION: 'Pembayaran sedang menunggu konfirmasi. Muat ulang halaman ini untuk melihat status terbaru.',
    PAYMENT_ALREADY_PAID: 'Pembayaran untuk pendaftaran ini sudah selesai.',
    PAYMENT_PROVIDER_ERROR: 'Layanan pembayaran sedang bermasalah. Pendaftaranmu tetap tercatat.',
    PAYMENT_ERROR: 'QRIS belum dapat dibuat. Pendaftaranmu tetap tercatat. Silakan coba lagi beberapa saat lagi.',
    SERVER_ERROR: 'Layanan pendaftaran sedang bermasalah. Silakan coba lagi.'
  };

  let isSubmitting = false;
  let registrationCompleted = false;

  if (paymentDemo) {
    registrationContent?.classList.add('hidden');
    eventFallback?.classList.add('hidden');
    registrationForm.querySelector('[type="submit"]').disabled = true;
    if (selectedEventIntro) selectedEventIntro.textContent = 'Pratinjau lokal · Bahagia Kasih';
    renderPaymentState(paymentDemo, {
      registration_code: 'KB-DEMO-123456', event_title: 'Bahagia Kasih (demo lokal)', amount: 35000
    });
  } else void initializeRegistrationEvent();

  registrationForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (paymentDemo) return;
    if (!selectedEvent || !registrationForm.checkValidity()) {
      registrationForm.reportValidity();
      return;
    }

    if (!REGISTRATION_CONFIG.registrationEndpoint) {
      showRegistrationMessage('Backend pendaftaran belum dikonfigurasi. Pendaftaran belum dapat dikirim.', 'error');
      return;
    }
    if (isSubmitting || registrationCompleted) return;

    const submitButton = registrationForm.querySelector('[type="submit"]');
    const originalButtonText = submitButton?.textContent || 'Kirim pendaftaran';
    isSubmitting = true;
    registrationForm.setAttribute('aria-busy', 'true');
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Mengirim...';
    }
    showRegistrationMessage('Mengirim data pendaftaran...', 'pending');

    try {
      const registration = await submitRegistration(registrationForm, selectedEvent.slug);
      const code = String(registration.registration_code || '');
      const title = String(registration.event_title || selectedEvent.name);
      if (!code || typeof registration.amount !== 'number'
        || typeof registration.registration_status !== 'string'
        || typeof registration.payment_status !== 'string') throw { code: 'SERVER_ERROR' };
      const isFreeConfirmed = registration.registration_status === 'confirmed'
        && registration.payment_status === 'not_required';
      const isPaidPending = registration.registration_status === 'pending_payment'
        && registration.payment_status === 'unpaid' && registration.amount > 0;

      if (isFreeConfirmed) {
        showRegistrationMessage(`Pendaftaran ${title} sudah tercatat. Kode pendaftaran kamu: ${code}.`, 'success');
      } else if (isPaidPending) {
        const payment = await createPayment(registration);
        showRegistrationMessage(`Pendaftaran ${title} sudah tercatat dengan kode ${code}.`, 'success');
        renderPaymentState('pending', payment);
        document.getElementById('registrationStatus')?.classList.add('hidden');
        pollPaymentStatus(payment, String(new FormData(registrationForm).get('email') || '').trim().toLowerCase());
      } else {
        throw { code: 'SERVER_ERROR' };
      }
      registrationCompleted = true;
      if (submitButton) submitButton.textContent = 'Pendaftaran tercatat';
      const resultStage = isFreeConfirmed ? document.getElementById('freeRegistrationConfirmation') : null;
      if (resultStage) {
        document.getElementById('paymentStage').hidden = true;
        resultStage.querySelector('[data-result-code]').textContent = code;
        resultStage.querySelector('[data-result-title]').textContent = title;
        renderOnboarding(resultStage.querySelector('[data-registration-onboarding]'), { whatsapp_group_url: null });
        resultStage.hidden = false;
        document.getElementById('registrationStatus')?.classList.add('hidden');
        resultStage.focus();
        try {
          const status = await fetchRegistrationStatus(
            registration,
            String(new FormData(registrationForm).get('email') || '').trim().toLowerCase(),
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
    } finally {
      isSubmitting = false;
      registrationForm.removeAttribute('aria-busy');
      if (!registrationCompleted && submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = originalButtonText;
      }
    }
  });
}
