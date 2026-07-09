self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = { title: 'Abatement Link alarm', body: event.data ? event.data.text() : 'New alarm notification' };
  }

  const title = payload.title || 'Abatement Link alarm';
  const options = {
    body: payload.body || 'A device alarm changed state.',
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/favicon.png',
    tag: payload.tag || 'abatement-link-alarm',
    renotify: true,
    requireInteraction: payload.requireInteraction ?? true,
    data: payload.data || { url: '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || '/';
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const absoluteUrl = new URL(targetUrl, self.location.origin).href;
    for (const client of allClients) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) return client.navigate(absoluteUrl);
        return;
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(absoluteUrl);
  })());
});
