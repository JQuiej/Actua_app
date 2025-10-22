// public/service-worker.js

const CACHE_NAME = 'actua-app-v1';

// Instalar Service Worker
self.addEventListener('install', (event) => {
  console.log('Service Worker instalado');
  self.skipWaiting();
});

// Activar Service Worker
self.addEventListener('activate', (event) => {
  console.log('Service Worker activado');
  event.waitUntil(clients.claim());
});

// Interceptar fetch (opcional para cache)
self.addEventListener('fetch', (event) => {
  // Dejar pasar todas las peticiones sin cache por ahora
  event.respondWith(fetch(event.request));
});

// ✅ NOTIFICACIONES PUSH
self.addEventListener('push', (event) => {
  console.log('Push recibido:', event);
  
  let data = {};
  if (event.data) {
    data = event.data.json();
  }

  const title = data.title || 'Nuevo Reporte';
  const options = {
    body: data.body || 'Hay actividad cerca de ti',
    icon: '/logo192.png',
    badge: '/logo192.png',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/',
      reportId: data.reportId
    },
    actions: [
      { action: 'open', title: 'Ver reporte' },
      { action: 'close', title: 'Cerrar' }
    ],
    requireInteraction: false,
    silent: false
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Manejar click en notificación
self.addEventListener('notificationclick', (event) => {
  console.log('Click en notificación:', event);
  
  event.notification.close();

  if (event.action === 'open' || !event.action) {
    const urlToOpen = event.notification.data.url || '/';
    
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then((clientList) => {
          // Si hay una ventana abierta, enfocarla
          for (let i = 0; i < clientList.length; i++) {
            const client = clientList[i];
            if (client.url === urlToOpen && 'focus' in client) {
              return client.focus();
            }
          }
          // Si no, abrir nueva ventana
          if (clients.openWindow) {
            return clients.openWindow(urlToOpen);
          }
        })
    );
  }
});