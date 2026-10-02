"use strict";

const CACHE_NAME = "ukayfind-guide-v7";
const APP_SHELL = [
  "./",
  "./index.html",
  "./guide.css",
  "./brand-enrichment.js",
  "./brand-data.js",
  "./guide-app.js",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./brand-logos/nike.svg",
  "./brand-logos/adidas.svg",
  "./brand-logos/puma.svg",
  "./brand-logos/reebok.svg",
  "./brand-logos/newbalance.svg",
  "./brand-logos/underarmour.svg",
  "./brand-logos/thenorthface.svg",
  "./brand-logos/uniqlo.svg",
  "./brand-logos/fila.svg",
  "./brand-logos/dior.svg",
  "./brand-logos/hermes.svg",
  "./brand-logos/nikon.svg",
  "./brand-logos/sony.svg",
  "./brand-logos/fujifilm.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.filter(name => name !== CACHE_NAME).map(name => caches.delete(name)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then(cached => cached || caches.match("./index.html")))
  );
});
