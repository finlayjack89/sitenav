const CACHE_NAME = 'sitenav-v4';
const API_CACHE = 'sitenav-api-v4';
const BASE = '/sitenav';

const STATIC_ASSETS = [
  BASE + '/',
  BASE + '/app.js',
  BASE + '/manifest.json',
  BASE + '/icons/icon.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== API_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const path = url.pathname;

  if (event.request.method !== 'GET') return;

  if (path === BASE + '/api/sites' || path === BASE + '/api/sites/') {
    event.respondWith(networkFirstWithCache(event.request, API_CACHE));
    return;
  }

  if (path.startsWith(BASE + '/api/')) {
    return;
  }

  if (path.startsWith('https://maps.googleapis.com/') || url.hostname === 'maps.googleapis.com') {
    event.respondWith(cacheFirstWithFallback(event.request));
    return;
  }

  if (path.startsWith(BASE)) {
    event.respondWith(cacheFirstWithFallback(event.request));
    return;
  }
});

async function networkFirstWithCache(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response('[]', {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function cacheFirstWithFallback(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}
