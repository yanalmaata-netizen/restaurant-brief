/* Service worker: приложение открывается без сети.
   Данные всё равно лежат в localStorage, поэтому офлайн — это рабочий режим,
   а не заглушка. Поднимайте CACHE при каждом изменении index.html. */
const CACHE = 'smena-v5.1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // PUT в KV не трогаем
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;             // шрифты и прочее — мимо
  if (url.pathname.indexOf('/api/') === 0) return;        // состояние всегда с сервера

  // Страницу берём из сети, но держим свежую копию в кэше на случай офлайна.
  if (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html')) {
    e.respondWith(
      fetch(req).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return r;
      }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(caches.match(req).then(r => r || fetch(req)));
});
