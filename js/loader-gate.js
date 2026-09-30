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
  const skip = () => root.classList.add('loader-skip');
  window.addEventListener('pointerdown', skip, { once: true });
  window.addEventListener('keydown', skip, { once: true });
  // After the loader and the delayed hero entrance are over, drop the class so later slide changes run on time.
  setTimeout(() => root.classList.remove('loader-on', 'loader-skip', 'loader-portal'), 3200);
})();
