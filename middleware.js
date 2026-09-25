// Vercel Routing Middleware: link previews for event registration links.
// WhatsApp, Instagram/Facebook, Telegram and similar bots do not run JavaScript,
// so they would only see the generic meta tags of the static pendaftaran.html.
// For those bots only, answer with a small HTML page carrying the event's own
// title, summary and poster. Everyone else gets the static page untouched.
export const config = { matcher: '/pendaftaran.html' };

const SITE = 'https://kitabahagia.vercel.app';
const EVENTS_URL = 'https://cmrdapfuqtjlmpepfwfq.supabase.co/functions/v1/public-events';
const DEFAULT_IMAGE = `${SITE}/img/og/jadwal.jpg`;
const PREVIEW_BOTS = /WhatsApp|facebookexternalhit|Facebot|meta-externalagent|Twitterbot|TelegramBot|LinkedInBot|Slackbot|Discordbot|Pinterest|SkypeUriPreview|redditbot|Embedly/i;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const formatDate = (iso, options) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', ...options }).format(date);
};

const describe = (event) => {
  const parts = [
    formatDate(event.start_at, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    event.location,
    event.registration_mode === 'selection' ? 'Seleksi' : (Number(event.price) > 0
      ? `Rp${new Intl.NumberFormat('id-ID').format(Number(event.price))}` : 'Gratis'),
  ].filter(Boolean);
  const deadline = event.registration_deadline && new Date(event.registration_deadline) > new Date()
    ? ` Daftar sebelum ${formatDate(event.registration_deadline, { day: 'numeric', month: 'long' })}.` : '';
  return `${parts.join(' · ')}.${deadline}`;
};

const imageUrl = (value) => {
  if (typeof value !== 'string' || !value) return DEFAULT_IMAGE;
  try {
    const url = new URL(value, SITE);
    return url.protocol === 'https:' ? url.href : DEFAULT_IMAGE;
  } catch {
    return DEFAULT_IMAGE;
  }
};

export default async function middleware(request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get('event') || '';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 120) return;
  if (!PREVIEW_BOTS.test(request.headers.get('user-agent') || '')) return;

  let event = null;
  try {
    const response = await fetch(`${EVENTS_URL}?slug=${encodeURIComponent(slug)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    const payload = response.ok ? await response.json() : null;
    event = payload?.events?.find((item) => item?.slug === slug) || null;
  } catch {
    event = null;
  }
  // Unknown or unavailable event: let the bot read the static page's generic tags.
  if (!event) return;

  const pageUrl = `${SITE}/pendaftaran.html?event=${encodeURIComponent(slug)}`;
  const title = `${event.title} | Kita Bahagia`;
  const description = describe(event);
  const image = imageUrl(event.image_url);
  const html = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(pageUrl)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Kita Bahagia">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(pageUrl)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:image:alt" content="${escapeHtml(event.image_alt || `Poster ${event.title}`)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(image)}">
</head>
<body>
<h1>${escapeHtml(event.title)}</h1>
<p>${escapeHtml(description)}</p>
<p><a href="${escapeHtml(pageUrl)}">Daftar di Kita Bahagia</a></p>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Never cached: this body is only for preview bots and must not be served to people.
      'Cache-Control': 'no-store',
      Vary: 'User-Agent',
    },
  });
}
