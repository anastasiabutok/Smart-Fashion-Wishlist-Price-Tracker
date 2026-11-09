// Minimal service worker so the app is installable. Network first; no offline data caching
// (prices must not look fresher than they are).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
