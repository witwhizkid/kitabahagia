const SITE_CONFIG = {
  whatsappNumber: "6285282672806",
  whatsappMessage: "Halo Joy, saya tertarik ikut kegiatan. Boleh minta info lengkap?",
  whatsappChannelUrl: "https://whatsapp.com/channel/0029VapOA3D0lwgi1687Hq0X",
  instagramUrl: "https://instagram.com/kitabahagiaa_",
  tiktokUrl: "https://tiktok.com/@kita.bahagia_",
  emailAddress: "kitabahagiaidn@gmail.com",
  email: "https://mail.google.com/mail/?view=cm&fs=1&to=kitabahagiaidn@gmail.com&su=Halo%20Kita%20Bahagia,%20saya%20tertarik%20ikut%20kegiatan.%20Boleh%20info%20kegiatan%20terdekat?&body=&bcc=",
};

const EVENTS = Array.isArray(window.KB_EVENTS) ? window.KB_EVENTS : [];
const EVENT_DATA = Object.freeze(Object.fromEntries(EVENTS.map((event) => [event.slug, event])));

const escapeHTML = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[character]));

const formatEventPrice = (price) => price === 0 ? 'Gratis' : new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0
}).format(price);

const activeEvents = EVENTS.filter((event) => {
  const endTime = new Date(event.end).getTime();
  return !Number.isNaN(endTime)
    && endTime >= Date.now()
    && !['closed', 'cancelled'].includes(String(event.statusKey).toLowerCase());
}).sort((a, b) => new Date(a.start) - new Date(b.start));

const eventRegistrationLink = (event, className, label) => `<a class="${className}"
  data-registration-link data-event-slug="${escapeHTML(event.slug)}"
  href="pendaftaran.html?event=${encodeURIComponent(event.slug)}">${label}</a>`;

const renderHomepageEvents = () => {
  const list = document.querySelector('[data-upcoming-list]');
  const empty = document.querySelector('[data-upcoming-empty]');
  if (!list || !empty) return;

  const events = activeEvents.slice(0, 3);
  if (!events.length) {
    list.hidden = true;
    empty.hidden = false;
    return;
  }

  const eventMarkup = (event, featured = false) => `<article class="home-upcoming-event${featured ? ' featured' : ''} reveal" data-upcoming-event>
    <figure><img src="${escapeHTML(event.image)}" alt="${escapeHTML(event.imageAlt)}"></figure>
    <div class="home-upcoming-event-copy">
      <div class="home-upcoming-event-topline"><span>${escapeHTML(event.category)}</span><span>${escapeHTML(event.status)}</span></div>
      <h3>${escapeHTML(event.name)}</h3>
      <dl class="home-upcoming-meta">
        <div><dt>Tanggal</dt><dd>${escapeHTML(event.date)}</dd></div>
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

const renderScheduleEvents = () => {
  const grid = document.getElementById('scheduleGrid');
  const featuredSection = document.querySelector('[data-schedule-featured]');
  const featured = document.getElementById('scheduleFeatured');
  const empty = document.getElementById('scheduleEmpty');
  const count = document.getElementById('scheduleCount');
  if (!grid || !featuredSection || !featured) return;

  if (!activeEvents.length) {
    featuredSection.hidden = true;
    empty?.classList.remove('hidden');
    if (count) count.textContent = 'Menampilkan 0 kegiatan';
    return;
  }

  const nextEvent = activeEvents[0];
  featured.innerHTML = `<article class="schedule-featured reveal">
    <figure class="schedule-featured-image"><img src="${escapeHTML(nextEvent.image)}" alt="${escapeHTML(nextEvent.imageAlt)}"></figure>
    <div class="schedule-featured-content"><span class="schedule-featured-label">Kegiatan terdekat</span>
      <h2 id="featuredEventTitle">${escapeHTML(nextEvent.name)}</h2><p>${escapeHTML(nextEvent.description)}</p>
      <dl class="schedule-featured-meta">
        <div><dt>Tanggal</dt><dd>${escapeHTML(nextEvent.date)}</dd></div><div><dt>Waktu</dt><dd>${escapeHTML(nextEvent.time)}</dd></div>
        <div><dt>Lokasi</dt><dd>${escapeHTML(nextEvent.location)}</dd></div><div><dt>Status</dt><dd>${escapeHTML(nextEvent.status)} · ${escapeHTML(nextEvent.capacity)}</dd></div>
      </dl>${eventRegistrationLink(nextEvent, 'btn btn-primary', 'Daftar')}
    </div></article>`;
  featuredSection.hidden = false;

  grid.innerHTML = activeEvents.map((event) => `<article class="schedule-card reveal" data-category="${escapeHTML(event.categoryKey)}" data-date="${escapeHTML(event.start)}">
    <time class="schedule-date" datetime="${escapeHTML(event.start.slice(0, 10))}"><strong>${escapeHTML(event.dateDay)}</strong><span>${escapeHTML(event.dateMonth)}</span></time>
    <div class="schedule-event"><span class="schedule-category">${escapeHTML(event.category)}</span><h2>${escapeHTML(event.name)}</h2><p>${escapeHTML(event.description)}</p></div>
    <div class="schedule-meta"><span>Waktu<strong>${escapeHTML(event.time)}</strong></span><span>Lokasi<strong>${escapeHTML(event.location)}</strong></span></div>
    <div class="schedule-status"><span class="status-label ${event.statusKey === 'limited' ? 'limited' : 'available'}">${escapeHTML(event.status)}</span><strong>${escapeHTML(event.capacity)}</strong></div>
    ${eventRegistrationLink(event, 'schedule-register', 'Daftar <span aria-hidden="true">&rarr;</span>')}
  </article>`).join('');
  if (count) count.textContent = `Menampilkan ${activeEvents.length} kegiatan`;
  empty?.classList.add('hidden');
};

renderHomepageEvents();
renderScheduleEvents();

// Configure these endpoints only after the production registration and payment flow exists.
const REGISTRATION_CONFIG = Object.freeze({
  registrationEndpoint: "https://cmrdapfuqtjlmpepfwfq.supabase.co/functions/v1/create-registration",
  paymentEndpoint: ""
});

const setMobileMenuState = (shouldOpen) => {
  const nav = document.querySelector('.nav');
  const toggle = document.querySelector('.menu-toggle');

  if (!nav || !toggle) return;

  nav.classList.toggle('open', shouldOpen);
  toggle.setAttribute('aria-expanded', String(shouldOpen));
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
document.querySelectorAll('[data-registration-link]').forEach(link => {
  const slug = (link.dataset.eventSlug || '').trim();
  if (!EVENT_DATA[slug]) return;

  link.href = `pendaftaran.html?event=${encodeURIComponent(slug)}`;
  link.removeAttribute('target');
  link.removeAttribute('rel');
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
  trigger.addEventListener('click', () => {
    const item = trigger.closest('.accordion-item');
    const wasOpen = item.classList.contains('open');
    document.querySelectorAll('.accordion-item').forEach(other => other.classList.remove('open'));
    if (!wasOpen) item.classList.add('open');
  });
});

const heroSlider = document.querySelector('[data-hero-slider]');
const heroSlides = Array.from(document.querySelectorAll('.hero-slide'));
const heroDots = Array.from(document.querySelectorAll('.hero-dot'));
const heroTrack = document.querySelector('.hero-campaign-track');

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
  reduceHeroMotion.addEventListener?.('change', startHeroAutoplay);
}

const testimonialSlides = Array.from(document.querySelectorAll('.testimonial-slide'));
const testimonialDots = Array.from(document.querySelectorAll('.testimonial-dot'));
const testimonialTrack = document.querySelector('.testimonial-track');
const prevTestimonialBtn = document.querySelector('.testimonial-arrow.prev');
const nextTestimonialBtn = document.querySelector('.testimonial-arrow.next');

if (testimonialSlides.length && testimonialTrack) {
  let activeIndex = 0;

  const updateTestimonials = () => {
    testimonialSlides.forEach((slide, index) => {
      slide.classList.toggle('active', index === activeIndex);
    });

    testimonialDots.forEach((dot, index) => {
      dot.classList.toggle('active', index === activeIndex);
    });

    testimonialTrack.style.transform = `translateX(-${activeIndex * 100}%)`;
  };

  prevTestimonialBtn?.addEventListener('click', () => {
    activeIndex = (activeIndex - 1 + testimonialSlides.length) % testimonialSlides.length;
    updateTestimonials();
  });

  nextTestimonialBtn?.addEventListener('click', () => {
    activeIndex = (activeIndex + 1) % testimonialSlides.length;
    updateTestimonials();
  });

  testimonialDots.forEach(dot => {
    dot.addEventListener('click', () => {
      activeIndex = Number(dot.dataset.index || 0);
      updateTestimonials();
    });
  });

  updateTestimonials();
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

const scheduleCards = [...document.querySelectorAll("[data-schedule-filter]")];
const eventCards = [...document.querySelectorAll("[data-category]")];
const scheduleCount = document.getElementById("scheduleCount");
const scheduleEmpty = document.getElementById("scheduleEmpty");

if (scheduleCards.length && eventCards.length) {
  scheduleCards.forEach((button) => {
    button.addEventListener("click", () => {
      const filter = button.dataset.scheduleFilter;
      scheduleCards.forEach((item) => {
        item.classList.remove("active");
        item.setAttribute("aria-pressed", String(item === button));
      });
      button.classList.add("active");
      let visible = 0;
      eventCards.forEach((card) => {
        const match = filter === "all" || card.dataset.category === filter;
        card.classList.toggle("hidden", !match);
        if (match) visible += 1;
      });
      if (scheduleCount) scheduleCount.textContent = `Menampilkan ${visible} kegiatan`;
      scheduleEmpty?.classList.toggle("hidden", visible !== 0);
    });
  });
}

function initScheduleCountdown() {
  const timer = document.getElementById("countdown");
  if (!timer) return;

  const events = eventCards
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
  const selectedEvent = EVENT_DATA[eventSlug];
  const registrationContent = document.getElementById('registrationContent');
  const eventFallback = document.getElementById('eventFallback');
  const selectedEventIntro = document.getElementById('selectedEventIntro');
  const paymentStates = {
    pending: ['Menunggu pembayaran', 'Layanan pembayaran belum tersedia. Belum ada pembayaran yang diproses.'],
    processing: ['Pembayaran sedang diverifikasi', 'Kami sedang memastikan pembayaranmu. Halaman ini akan diperbarui setelah statusnya terkonfirmasi.'],
    paid: ['Pembayaran berhasil', 'Tempatmu sudah dikonfirmasi.'],
    expired: ['Waktu pembayaran habis', 'QRIS sebelumnya sudah tidak dapat digunakan.'],
    failed: ['Pembayaran belum berhasil', 'Pendaftaranmu tetap tercatat. Pembayaran dapat dicoba kembali setelah layanan pembayaran tersedia.']
  };
  const paymentStatusCopy = {
    pending: paymentStates.pending,
    processing: ['Pembayaran sedang diperiksa', 'Pembayaranmu sedang diperiksa. Tidak perlu melakukan pembayaran ulang.'],
    expired: ['Pendaftaran tetap tercatat', 'Opsi pembayaran baru akan tersedia setelah layanan pembayaran terhubung.']
  };
  const requestedDemo = ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? params.get('payment_demo') : null;
  const paymentDemo = Object.hasOwn(paymentStates, requestedDemo) ? requestedDemo : null;

  const renderPaymentState = (state, data) => {
    const stage = document.getElementById('paymentStage');
    if (!stage || !Object.hasOwn(paymentStates, state)) return;
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
    stage.querySelector('[data-payment-amount]').textContent = formatEventPrice(data.amount);
    stage.querySelector('#paymentHeading').textContent = state === 'pending' ? 'Selesaikan pembayaran' : heading;
    stage.querySelector('.payment-primary > p').textContent = state === 'pending'
      ? 'Pendaftaranmu sudah tercatat. Selesaikan pembayaran untuk mengamankan tempatmu.' : body;
    stage.querySelector('.payment-details dl > div:last-child dd').textContent = state === 'paid'
      ? 'Pendaftaran kegiatan · pembayaran dikonfirmasi' : `Pendaftaran kegiatan · ${heading.toLowerCase()}`;
    const qr = stage.querySelector('.payment-qr-placeholder');
    qr.hidden = state !== 'pending';
    qr.setAttribute('aria-label', 'QRIS belum tersedia');
    qr.querySelector('span').textContent = 'QRIS belum tersedia';
    qr.querySelector('p').textContent = 'QRIS akan muncul di sini setelah layanan pembayaran terhubung.';
    stage.querySelector('.payment-countdown').hidden = state !== 'pending';
    document.getElementById('freeRegistrationConfirmation').hidden = true;
    stage.hidden = false;
    stage.focus();
  };

  if (!selectedEvent) {
    if (selectedEventIntro) selectedEventIntro.textContent = 'Kegiatan belum dipilih';
    eventFallback?.classList.remove('hidden');
  } else {
    const setText = (id, value) => {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    };

    if (selectedEventIntro) selectedEventIntro.textContent = selectedEvent.name;
    setText('eventName', selectedEvent.name);
    setText('eventDate', selectedEvent.date);
    setText('eventTime', selectedEvent.time);
    setText('eventLocation', selectedEvent.location);
    setText('eventStatus', `${selectedEvent.status} · ${selectedEvent.capacity}`);

    const eventNameInput = document.getElementById('kegiatan');
    const eventSlugInput = document.getElementById('eventSlug');
    if (eventNameInput) eventNameInput.value = selectedEvent.name;
    if (eventSlugInput) eventSlugInput.value = selectedEvent.slug;

    if (selectedEvent.price !== null && selectedEvent.price !== undefined) {
      setText('eventPrice', formatEventPrice(selectedEvent.price));
      document.getElementById('eventPriceRow')?.classList.remove('hidden');
    }

    registrationContent?.classList.remove('hidden');
    const submitButton = registrationForm.querySelector('[type="submit"]');
    const availabilityNote = document.getElementById('registrationAvailabilityNote');
    const registrationAvailable = Boolean(REGISTRATION_CONFIG.registrationEndpoint);
    if (submitButton) {
      submitButton.disabled = !registrationAvailable;
      submitButton.textContent = 'Kirim pendaftaran';
    }
    if (availabilityNote) {
      availabilityNote.textContent = registrationAvailable
        ? 'Pastikan data sudah benar sebelum mengirim pendaftaran.'
        : 'Backend pendaftaran belum dikonfigurasi. Form belum dapat dikirim.';
    }
  }

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
      body: JSON.stringify(payload)
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
  }

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
        const amount = formatEventPrice(registration.amount);
        showRegistrationMessage(`Pendaftaran ${title} sudah tercatat dengan kode ${code}. Biaya ${amount}; pembayaran belum diselesaikan dan layanan pembayaran belum tersedia.`, 'pending');
      } else {
        throw { code: 'SERVER_ERROR' };
      }
      registrationCompleted = true;
      if (submitButton) submitButton.textContent = 'Pendaftaran tercatat';
      if (isPaidPending) {
        renderPaymentState('pending', registration);
        document.getElementById('registrationStatus')?.classList.add('hidden');
      }
      const resultStage = isFreeConfirmed ? document.getElementById('freeRegistrationConfirmation') : null;
      if (resultStage) {
        document.getElementById('paymentStage').hidden = true;
        resultStage.querySelector('[data-result-code]').textContent = code;
        resultStage.querySelector('[data-result-title]').textContent = title;
        resultStage.hidden = false;
        document.getElementById('registrationStatus')?.classList.add('hidden');
        resultStage.focus();
      }
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
