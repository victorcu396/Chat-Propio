/* ============================================================
   kiVooSpace — Service Worker
   Estrategia: Network-first para HTML/JS, Cache-first para assets
============================================================ */

const CACHE_NAME = 'kivoospace-v58';

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

/* ── MESSAGE desde el cliente: cerrar notificaciones por tag ── */
self.addEventListener('message', (event) => {
  if (!event.data) return;

  // El cliente pide cerrar todas las notificaciones de un tag concreto
  if (event.data.type === 'CLEAR_NOTIFICATIONS') {
    const tag = event.data.tag;
    const promise = tag
      ? self.registration.getNotifications({ tag }).then(notifs => notifs.forEach(n => n.close()))
      : self.registration.getNotifications().then(notifs => notifs.forEach(n => n.close()));
    event.waitUntil ? event.waitUntil(promise) : promise;
  }
});

/* ── PUSH: recibir notificación del servidor y mostrarla ── */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch(e) {
    data = { title: '💬 kiVooSpace', body: event.data ? event.data.text() : 'Nuevo mensaje' };
  }

  const title   = data.title  || '💬 kiVooSpace';
  const options = {
    body:             data.body    || 'Nuevo mensaje',
    icon:             data.icon    || '/icon-192.png',
    badge:            data.badge   || '/icon-192.png',
    tag:              data.tag     || 'kvs-msg',
    renotify:         data.renotify !== undefined ? data.renotify : true,
    requireInteraction: false,
    silent:           false,
    data:             data.data    || {},
    // Vibración en móvil: patrón corto estilo WhatsApp
    vibrate:          [200, 100, 200]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/* ── NOTIFICATIONCLICK: al tocar la notificación, abrir/enfocar la app ── */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const chatKey = event.notification.data && event.notification.data.chatKey;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Si ya hay una ventana/pestaña de la app abierta, enfocarla
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          // Enviar mensaje al cliente para que abra el chat correspondiente
          if (chatKey) {
            client.postMessage({ type: 'OPEN_CHAT', chatKey });
          }
          return;
        }
      }
      // Si no hay ventana abierta, abrir una nueva
      const url = chatKey ? `/?openChat=${encodeURIComponent(chatKey)}` : '/';
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});