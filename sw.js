const CACHE_NAME = 'vocab-es-uk-v11';

// Solo cachear iconos e imágenes estáticas (no JS/CSS/HTML que cambian frecuentemente)
const STATIC_ASSETS = [
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './icons/favicon-32.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Llamadas a APIs externas y Firebase: siempre red
  if (!url.hostname.includes('github.io') && !url.hostname.includes('localhost')) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }

  // Archivos JS, CSS, HTML y JSON de la app: red primero, caché como fallback
  // Así los usuarios SIEMPRE ven la versión más reciente
  if (url.pathname.match(/\.(js|css|html|json)$/)) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Iconos y assets estáticos: caché primero
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
