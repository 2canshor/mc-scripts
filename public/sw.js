// Event Centre's offline help (使用教學): the page itself is fetched from the network first and kept for when there is no
// connection; the help videos and posters, once downloaded from the help page, are served from their cache, a part of a
// video at a time as Safari asks for it.
const SHELL = 'ec-shell-v1', HELP = 'ec-help-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname.startsWith('/help/')) { e.respondWith(help(r, u.pathname)); return; }
  if (r.mode === 'navigate' && u.pathname === '/') e.respondWith(fetch(r).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put('/', copy)); }
    return res;
  }).catch(() => caches.open(SHELL).then(c => c.match('/')).then(res => res || Response.error())));
});
async function help(r, path) {
  const hit = await (await caches.open(HELP)).match(path);
  if (!hit) return fetch(r);
  const range = r.headers.get('range');
  if (!range) return hit;
  const buf = await hit.arrayBuffer(), size = buf.byteLength, m = /bytes=(\d*)-(\d*)/.exec(range) || [];
  let start = m[1] ? +m[1] : size - +(m[2] || size), end = m[1] && m[2] ? +m[2] : size - 1;
  end = Math.min(end, size - 1); start = Math.max(0, Math.min(start, end));
  return new Response(buf.slice(start, end + 1), {status: 206, headers: {'Content-Type': hit.headers.get('Content-Type') || 'video/mp4',
    'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes'}});
}
