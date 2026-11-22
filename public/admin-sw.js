// Service worker for Jeselle's admin page: shows notifications only (no caching, no page changes).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'New activity', body: e.data ? e.data.text() : '' }; }
  const show = self.registration.showNotification(d.title || 'New activity on your website', {
    body: d.body || '', tag: d.tag || undefined, renotify: true, icon: '/images/apple-touch-icon.png', badge: '/images/apple-touch-icon.png',
    data: { url: d.url || '/admin.html' },
  });
  const badge = self.navigator && self.navigator.setAppBadge ? self.navigator.setAppBadge().catch(() => {}) : Promise.resolve();
  e.waitUntil(Promise.all([show, badge]));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/admin.html', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url.includes('/admin.html') && 'focus' in c) { c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
