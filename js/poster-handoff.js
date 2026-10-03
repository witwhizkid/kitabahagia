// Event card → pendaftaran "poster flight" (cross-document view transition, see style.css). The card
// page stored the clicked poster; this runs before the first render so the summary thumbnail already
// shows that poster when the browser captures the new page, and the two morph into each other.
window.addEventListener('pagereveal', (event) => {
  let handoff = null;
  try {
    handoff = JSON.parse(sessionStorage.getItem('kb_poster') || 'null');
    sessionStorage.removeItem('kb_poster');
  } catch {
    return;
  }
  if (!event.viewTransition || !handoff) return;
  const wrap = document.getElementById('eventImageWrap');
  const image = document.getElementById('eventImage');
  if (!wrap || !image || handoff.slug !== new URLSearchParams(location.search).get('event')) return;
  event.viewTransition.types?.add('poster');
  image.loading = 'eager';
  image.src = handoff.src;
  wrap.hidden = false;
  wrap.closest('.reveal')?.classList.add('visible');
  image.style.viewTransitionName = 'event-poster';
  event.viewTransition.finished.finally(() => { image.style.viewTransitionName = ''; });
});
