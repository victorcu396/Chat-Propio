/* ============================================================
   kiVooSpace — Service Worker
   Estrategia: Network-first para HTML/JS, Cache-first para assets
============================================================ */

const CACHE_NAME = 'kivoospace-v26';

// Archivos que se cachean al instalar la PWA
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/Logo_kiVooSpace.png',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap'
];

/* ── INSTALL: precachear assets esenciales ── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        // Si algún asset externo falla (fuentes), no bloquear la instalación
        console.warn('[SW] Precache parcial:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

/* ── ACTIVATE: limpiar caches antiguas ── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── FETCH: estrategia inteligente ── */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // WebSocket: nunca interceptar
  if (request.url.startsWith('ws://') || request.url.startsWith('wss://')) {
    return;
  }

  // API calls (/api/*): siempre red, nunca caché
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // Navegación (HTML): Network-first → fallback a caché
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Guardar copia fresca en caché
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Assets estáticos (imágenes, fuentes, CSS, JS): Cache-first → red
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // Solo cachear respuestas válidas
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return response;
      });
    })
  );
});