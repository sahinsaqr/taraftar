// Uygulama dosyalarını önbelleğe alır; internet yokken son veriler gösterilir.
const SURUM = 'taraftar-v12';
const KABUK = ['./', 'index.html', 'style.css', 'app.js', 'bulut.js', 'firebase-ayar.js', 'manifest.webmanifest',
  'ikonlar/ikon.svg', 'ikonlar/favicon-64.png', 'ikonlar/ikon-192.png', 'ikonlar/apple-touch-icon.png', 'kutuphane/Sortable.min.js', 'package.json',
  ...['barlow-latin', 'barlow-latin-ext'].flatMap((a) => [400, 500, 600, 700].map((k) => `yazitipleri/${a}-${k}-normal.woff2`)),
  ...['barlow-condensed-latin', 'barlow-condensed-latin-ext'].flatMap((a) => [600, 700].map((k) => `yazitipleri/${a}-${k}-normal.woff2`))];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SURUM).then((c) => c.addAll(KABUK)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((k) => Promise.all(k.filter((x) => x !== SURUM && x !== 'logolar').map((x) => caches.delete(x))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Takım logoları: önce önbellek
  if (url.hostname === 'a.espncdn.com') {
    e.respondWith(caches.open('logolar').then(async (c) => {
      const var_ = await c.match(e.request);
      if (var_) return var_;
      const r = await fetch(e.request);
      if (r.ok || r.type === 'opaque') c.put(e.request, r.clone());
      return r;
    }));
    return;
  }
  if (url.origin !== location.origin) return;

  // Veri dosyaları ve sayfa: önce ağ, olmazsa önbellek
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((r) => {
    if (r.ok) {
      const kopya = r.clone();
      const anahtar = url.pathname.includes('/veri/') || url.pathname.endsWith('takip.json')
        ? url.origin + url.pathname : e.request;
      caches.open(SURUM).then((c) => c.put(anahtar, kopya));
    }
    return r;
  }).catch(() => caches.match(url.origin + url.pathname).then((r) => r || caches.match(e.request))));
});
