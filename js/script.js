const SITE_CONFIG = {
  whatsappNumber: "6285282672806",
  whatsappMessage: "Halo Joy, saya tertarik ikut kegiatan. Boleh info kegiatan terdekat?",
  whatsappChannelUrl: "https://whatsapp.com/channel/0029VapOA3D0lwgi1687Hq0X",
  instagramUrl: "https://instagram.com/kitabahagiaa_",
  tiktokUrl: "https://tiktok.com/@kita.bahagia_",
  emailAddress: "kitabahagiaidn@gmail.com",
  email: "https://mail.google.com/mail/?view=cm&fs=1&to=kitabahagiaidn@gmail.com&su=Halo%20Kita%20Bahagia,%20saya%20tertarik%20ikut%20kegiatan.%20Boleh%20info%20kegiatan%20terdekat?&body=&bcc=",
};

const EVENT_DATA = Object.freeze({
  "asa-raya-baduy": {
    slug: "asa-raya-baduy",
    name: "Asa Raya Baduy",
    date: "29–30 Agustus 2026",
    time: "09.00–12.00 WIB",
    location: "Baduy, Banten",
    status: "Tersedia",
    capacity: "12 slot tersisa",
    category: "Komunitas",
    price: null
  },
  "blueventure-di-pulau-tidung": {
    slug: "blueventure-di-pulau-tidung",
    name: "Blueventure di Pulau Tidung",
    date: "5–6 September 2026",
    time: "13.00–15.30 WIB",
    location: "Pulau Tidung, Jakarta",
    status: "Tersedia",
    capacity: "8 slot tersisa",
    category: "Anak-anak",
    price: null
  },
  "bahagia-kasih": {
    slug: "bahagia-kasih",
    name: "Bahagia Kasih",
    date: "24 Agustus 2026",
    time: "10.00–12.00 WIB",
    location: "Bandung",
    status: "Terbatas",
    capacity: "3 slot tersisa",
    category: "Kreatif",
    price: null
  },
  "bahagia-belajar-beraksi": {
    slug: "bahagia-belajar-beraksi",
    name: "Bahagia Belajar & Beraksi",
    date: "31 Agustus 2026",
    time: "08.30–11.30 WIB",
    location: "Bandung",
    status: "Tersedia",
    capacity: "20 slot tersisa",
    category: "Lingkungan",
    price: null
  }
});

// Configure these endpoints only after the production registration and payment flow exists.
const REGISTRATION_CONFIG = Object.freeze({
  registrationEndpoint: "",
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
      setText('eventPrice', new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0
      }).format(selectedEvent.price));
      document.getElementById('eventPriceRow')?.classList.remove('hidden');
    }

    registrationContent?.classList.remove('hidden');
    const submitButton = registrationForm.querySelector('[type="submit"]');
    const availabilityNote = document.getElementById('registrationAvailabilityNote');
    const registrationAvailable = Boolean(REGISTRATION_CONFIG.registrationEndpoint);
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = registrationAvailable ? 'Kirim pendaftaran' : 'Daftar via WhatsApp';
    }
    if (availabilityNote) {
      availabilityNote.textContent = registrationAvailable
        ? 'Pastikan data sudah benar sebelum mengirim pendaftaran.'
        : 'Belum ada pengiriman otomatis. Setelah data lengkap, lanjutkan pendaftaran melalui WhatsApp.';
    }
  }

  const showRegistrationMessage = (message, state = 'pending') => {
    const status = document.getElementById('registrationStatus');
    if (!status) return;
    status.textContent = message;
    status.className = `registration-message is-${state}`;
    status.focus();
  };

  const submitRegistration = async (form) => {
    if (!REGISTRATION_CONFIG.registrationEndpoint) {
      return { configured: false };
    }

    const response = await fetch(REGISTRATION_CONFIG.registrationEndpoint, {
      method: 'POST',
      body: new FormData(form),
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) throw new Error('Registration request failed');
    return { configured: true, response };
  };

  const buildRegistrationWhatsAppUrl = (form, eventData) => {
    const formData = new FormData(form);
    const lines = [
      'Halo Kita Bahagia, saya ingin mendaftar kegiatan.',
      '',
      `Kegiatan: ${eventData.name}`,
      `Nama: ${formData.get('nama') || '-'}`,
      `Nomor WhatsApp: ${formData.get('telepon') || '-'}`,
      `Email: ${formData.get('email') || '-'}`
    ];
    const reason = String(formData.get('alasan') || '').trim();
    const notes = String(formData.get('catatan') || '').trim();
    if (reason) lines.push(`Alasan ikut: ${reason}`);
    if (notes) lines.push(`Catatan: ${notes}`);
    lines.push('', 'Mohon informasi langkah pendaftaran berikutnya.');

    return `https://wa.me/${SITE_CONFIG.whatsappNumber}?text=${encodeURIComponent(lines.join('\n'))}`;
  };

  registrationForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!selectedEvent || !registrationForm.checkValidity()) {
      registrationForm.reportValidity();
      return;
    }

    const submitButton = registrationForm.querySelector('[type="submit"]');
    if (submitButton) submitButton.disabled = true;

    if (!REGISTRATION_CONFIG.registrationEndpoint) {
      const whatsappUrl = buildRegistrationWhatsAppUrl(registrationForm, selectedEvent);
      window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
      showRegistrationMessage('WhatsApp telah dibuka. Pendaftaran belum tercatat sampai kamu mengirim pesannya ke tim Kita Bahagia.', 'pending');
      if (submitButton) submitButton.disabled = false;
      return;
    }

    try {
      const result = await submitRegistration(registrationForm);
      showRegistrationMessage('Pendaftaran diterima. Tim Kita Bahagia akan menghubungi kamu untuk langkah berikutnya.', 'success');
      registrationForm.reset();
    } catch (error) {
      showRegistrationMessage('Pendaftaran belum dapat dikirim. Periksa koneksi lalu coba lagi, atau hubungi tim Kita Bahagia.', 'error');
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}
