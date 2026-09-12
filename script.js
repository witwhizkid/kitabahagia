const SITE_CONFIG = {
  whatsappNumber: "6281234567890",
  whatsappMessage: "Halo Kita Bahagia, saya tertarik ikut kegiatan. Boleh info kegiatan terdekat?",
  instagramUrl: "https://instagram.com/kitabahagiaa_",
  tiktokUrl: "https://tiktok.com/@kita.bahagia_",
  email: "semuabahagiabareng@gmail.com"
};

document.querySelector('.menu-toggle')?.addEventListener('click', () => {
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.nav');
  const open = nav.classList.toggle('open');
  toggle.setAttribute('aria-expanded', String(open)); 

});

document.querySelectorAll('.nav a').forEach(link => link.addEventListener('click', () => {
  document.querySelector('.nav')?.classList.remove('open');
  document.querySelector('.menu-toggle')?.setAttribute('aria-expanded', 'false');
}));

const waUrl = `https://wa.me/${SITE_CONFIG.whatsappNumber}?text=${encodeURIComponent(SITE_CONFIG.whatsappMessage)}`;
document.querySelectorAll('[data-wa]').forEach(link => {
  link.href = waUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
});
document.querySelectorAll('[data-instagram]').forEach(link => { link.href = SITE_CONFIG.instagramUrl; link.target='_blank'; link.rel='noopener noreferrer'; });
document.querySelectorAll('[data-tiktok]').forEach(link => { link.href = SITE_CONFIG.tiktokUrl; link.target='_blank'; link.rel='noopener noreferrer'; });
document.querySelectorAll('[data-email]').forEach(link => link.href = `mailto:${SITE_CONFIG.email}`);

document.querySelectorAll('.accordion-trigger').forEach(trigger => {
  trigger.addEventListener('click', () => {
    const item = trigger.closest('.accordion-item');
    const wasOpen = item.classList.contains('open');
    document.querySelectorAll('.accordion-item').forEach(other => other.classList.remove('open'));
    if (!wasOpen) item.classList.add('open');
  });
});

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
