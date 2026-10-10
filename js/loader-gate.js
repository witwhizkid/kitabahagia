// Beranda loader gate (render-blocking on purpose, so it runs before first paint): shows the KB
// loader only when Beranda is the first page of the visit and motion is allowed. script.js marks
// the session on every page, so arriving here from another page (behind the page curtain) skips it.
(() => {
  const root = document.documentElement;
  let seen = false;
  try { seen = sessionStorage.getItem('kb_visit') === '1'; } catch { seen = true; }
  if (seen || !window.matchMedia('(prefers-reduced-motion: no-preference)').matches) return;
  // Back/forward restores a frozen copy of the page: never resume the loader there.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) root.classList.remove('loader-on', 'loader-skip', 'loader-portal', 'loader-land', 'loader-landing');
  });
  root.classList.add('loader-on');
  const start = () => {
    root.classList.remove('loader-hold');
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
    // Skipping only makes sense before the finale starts (0.86s). Later, a first touch to scroll would
    // restart the panel animation and play the loader a second time.
    const skip = () => root.classList.add('loader-skip');
    window.addEventListener('pointerdown', skip, { once: true });
    window.addEventListener('keydown', skip, { once: true });
    setTimeout(() => {
      window.removeEventListener('pointerdown', skip);
      window.removeEventListener('keydown', skip);
    }, 850);
    // After the loader and the delayed hero entrance are over, drop the class so later slide changes run on time.
    setTimeout(() => root.classList.remove('loader-on', 'loader-skip', 'loader-portal', 'loader-land', 'loader-landing'), 3200);
  };
  // Chrome may prerender Beranda while the address is still being typed; the loader then played
  // unseen and the hero showed first. While prerendering the panel stays shut (animations paused)
  // and the timers wait; everything starts when the page is actually shown.
  if (document.prerendering) {
    root.classList.add('loader-hold');
    document.addEventListener('prerenderingchange', start, { once: true });
  } else start();
})();
