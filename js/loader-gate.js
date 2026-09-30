// Beranda loader gate (render-blocking on purpose, so it runs before first paint): shows the KB
// loader only when Beranda is the first page of the visit and motion is allowed. script.js marks
// the session on every page, so arriving here from another page (behind the page curtain) skips it.
(() => {
  const root = document.documentElement;
  let seen = false;
  try { seen = sessionStorage.getItem('kb_visit') === '1'; } catch { seen = true; }
  if (seen || !window.matchMedia('(prefers-reduced-motion: no-preference)').matches) return;
  root.classList.add('loader-on');
  // Strong phones/laptops open Beranda through the logo; weak phones keep the plain upward panel.
  if ((navigator.hardwareConcurrency || 4) >= 6 && (navigator.deviceMemory || 8) >= 4) root.classList.add('loader-portal');
  else {
    // Weak devices: the drawn mark flies into the "Makna" pill (transform only) while the panel fades.
    root.classList.add('loader-land');
    setTimeout(() => {
      const mark = document.querySelector('.kb-loader-mark');
      const pill = document.querySelector('.hero-slide:first-child .hero-pill');
      if (!mark || !pill || root.classList.contains('loader-skip')) return;
      const a = mark.getBoundingClientRect();
      const b = pill.getBoundingClientRect();
      if (!b.width) return;
      // The title is still at its entrance offset; land where it will settle.
      const settle = new DOMMatrix(getComputedStyle(pill.closest('h1, h2')).transform).m42;
      mark.style.setProperty('--land-x', `${b.left + b.width / 2 - (a.left + a.width / 2)}px`);
      mark.style.setProperty('--land-y', `${b.top - settle + b.height / 2 - (a.top + a.height / 2)}px`);
      mark.style.setProperty('--land-s', String(b.height / a.height));
      root.classList.add('loader-landing');
    }, 860);
  }
  const skip = () => root.classList.add('loader-skip');
  window.addEventListener('pointerdown', skip, { once: true });
  window.addEventListener('keydown', skip, { once: true });
  // After the loader and the delayed hero entrance are over, drop the class so later slide changes run on time.
  setTimeout(() => root.classList.remove('loader-on', 'loader-skip', 'loader-portal', 'loader-land', 'loader-landing'), 3200);
})();
