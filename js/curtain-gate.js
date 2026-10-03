// Page curtain, arriving side (Oct 2026). The page that was left raised a maroon curtain and set
// sessionStorage kb_curtain; this tiny render-blocking script makes the new page start under the same
// curtain (html.curtain-in, drawn by CSS) and lifts it once the DOM is ready. Before, the reveal relied
// on the cross-document view transition, which Chrome sometimes skipped or cut short on slow loads.
(() => {
  try {
    if (sessionStorage.getItem('kb_curtain') !== '1') return;
    sessionStorage.removeItem('kb_curtain');
  } catch {
    return;
  }
  if (!window.matchMedia('(prefers-reduced-motion: no-preference)').matches) return;
  const root = document.documentElement;
  root.classList.add('curtain-in');
  let opened = false;
  const open = () => {
    if (opened) return;
    opened = true;
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('curtain-open')));
  };
  root.addEventListener('animationend', (event) => {
    if (event.animationName === 'kb-curtain-lift') root.classList.remove('curtain-in', 'curtain-open');
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', open, { once: true });
  else open();
  setTimeout(open, 1800);
})();
