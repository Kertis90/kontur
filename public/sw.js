const CACHE = "kontur-shell-v10";
const SHELL = ["/", "/manifest.webmanifest", "/icons/kontur-192.png", "/icons/kontur-512.png"];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('kontur-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  const navigation = event.request.mode === 'navigate' && url.pathname === '/';
  const asset = url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest';
  if (!navigation && !asset) return;
  const cacheKey = navigation ? '/' : event.request;
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok && !response.redirected) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(cacheKey, copy)).catch(() => {}));
      }
      return response;
    } catch {
      return (await caches.match(cacheKey)) || Response.error();
    }
  })());
});
function notificationUrl(value) {
  try {
    const url = new URL(value || '/', self.location.origin);
    if(url.origin !== self.location.origin || url.pathname !== '/') return '/';
    const channel = url.searchParams.get('channel');
    return url.searchParams.get('view') === 'chat' && /^[1-9]\d*$/.test(channel || '') ? `/?view=chat&channel=${channel}` : '/?notifications=1';
  } catch { return '/'; }
}
self.addEventListener('push', event => {
  let value = {}; try { value = event.data?.json() || {}; } catch {}
  event.waitUntil(self.registration.showNotification('Контур', {
    body:'Есть новые сообщения или уведомления', icon:'/icons/kontur-192.png', badge:'/icons/kontur-192.png',
    tag: /^kontur-\d+$/.test(value.tag || '') ? value.tag : 'kontur',
    data:{url:notificationUrl(value.url)},
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const path = notificationUrl(event.notification.data?.url);
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const client = clients.find(item => new URL(item.url).origin === self.location.origin && new URL(item.url).pathname === '/');
    if(client) { await client.focus(); client.postMessage({type:'kontur:notification',url:path}); }
    else await self.clients.openWindow(path);
  })());
});
