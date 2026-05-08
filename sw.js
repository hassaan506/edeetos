const CACHE_NAME = 'edeetos-app-v1';

// We are caching your core authentication files here
const ASSETS_TO_CACHE = [
  '/login.html',
  '/login.js',
  '/register.html',
  '/register.js',
  '/global.css',
  '/auth.css',
  '/firebase-config.js',
  '/auth-check.js'
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
});

// Activate event: Cleans up old caches if you update CACHE_NAME
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
});

// Fetch event: Serves cached files if offline
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Return cached version or fetch from network
        return response || fetch(event.request);
      })
  );
});