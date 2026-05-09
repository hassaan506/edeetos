const CACHE_NAME = 'edeetos-app-dynamic-v1';

const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./login.html",
  "./login.js",
  "./register.html",
  "./register.js",
  "./global.css",
  "./auth.css",
  "./firebase-config.js",
  "./auth-check.js"
];

// Install event: Caches the initial assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Caching essential assets');
        return cache.addAll(ASSETS_TO_CACHE);
      })
  );
  // Force the waiting service worker to become the active service worker immediately
  self.skipWaiting();
});

// Activate event: Cleans up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            console.log('Clearing old cache');
            return caches.delete(cache);
          }
        })
      );
    })
  );
  // Tell the active service worker to take control of the page immediately
  self.clients.claim();
});

// Fetch event: NETWORK-FIRST STRATEGY
// This means it will ALWAYS try to load your latest code from the internet first.
// If it succeeds, it updates the cache automatically.
// You do NOT need to edit this file when you update your website code anymore!
self.addEventListener('fetch', event => {
  // Only handle GET requests (Firebase uses POST for database/auth)
  if (event.request.method !== 'GET') return;
  // Ignore chrome-extension:// and other non-http schemes
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        // If network request is successful, clone it and update the cache dynamically!
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // If the user is offline (network fails), serve the file from the cache
        return caches.match(event.request);
      })
  );
});