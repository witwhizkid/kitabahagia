// Cloudflare Pages Function: iPaymu production only accepts a notifyUrl on the domain registered in
// the merchant account (kitabahagia.id), not the Supabase URL ("Invalid domain", Oct 2026). Its
// callback lands here and is passed on unchanged to the Edge Function, which re-reads the status
// from the iPaymu API, so this hop trusts nothing in the body.
const TARGET = 'https://cmrdapfuqtjlmpepfwfq.supabase.co/functions/v1/ipaymu-webhook';

export async function onRequestPost({ request }) {
  const response = await fetch(TARGET, {
    method: 'POST',
    headers: { 'content-type': request.headers.get('content-type') || 'application/x-www-form-urlencoded' },
    body: await request.arrayBuffer(),
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') || 'text/plain; charset=utf-8' },
  });
}
