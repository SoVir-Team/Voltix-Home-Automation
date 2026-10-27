// Voltix service worker: shows web push notifications and opens the app when one is tapped.
// No offline caching on purpose: device state must always come from the server.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Voltix', body: event.data?.text() ?? '' };
  }
  // Payload from the API: { title, body, data: { type, deviceId?, ... } }
  const extra = data.data || {};
  const url = extra.deviceId ? `/devices/${extra.deviceId}` : '/notifications';
  event.waitUntil(
    self.registration.showNotification(data.title || 'Voltix', {
      body: data.body || '',
      icon: '/brand/icon-192.png',
      badge: '/brand/icon-192.png',
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        open.focus();
        return open.navigate(url);
      }
      return self.clients.openWindow(url);
    }),
  );
});
