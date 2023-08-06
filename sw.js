// Files to cache
var cacheName = "doorlock1";
var contentToCache = [
  ".",
  "base.css",
  "icon.png",
  "index.html",
  "main.js",
  "page-keys.css",
  "page-edit-key.css",
];

// Delete old caches
self.addEventListener("activate", (e) => {
  console.log("[Service Worker] Activate");
  e.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== cacheName) {
          console.log(`[Service Worker] Deleting cache: ${key}`);
          return caches.delete(key);
        }
      }));
    })
  );
});

// Installing Service Worker
self.addEventListener("install", (e) => {
  console.log("[Service Worker] Install");
  e.waitUntil(
    caches.open(cacheName).then((cache) => {
      console.log("[Service Worker] Caching all: app shell and content");
      return cache.addAll(contentToCache);
    })
  );
});

// Fetching content using Service Worker
self.addEventListener("fetch", (e) => {
  e.respondWith(
    caches.open(cacheName).then((cache) => {
      return cache.match(e.request).then((r) => {
        console.log(`[Service Worker] Fetching resource: ${e.request.url}`);
        return r || fetch(e.request).then((response) => {
          console.log(`[Service Worker] Caching new resource: ${e.request.url}`);
          cache.put(e.request, response.clone());
          return response;
        });
      })
    })
  );
});
