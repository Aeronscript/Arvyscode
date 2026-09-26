/* Arvys Cloud — service worker v2 : coquille hors-ligne de l'UI complète */
const CACHE = "arvys-v2";
const SHELL = [
  "/",
  "/chat.html",
  "/download.html",
  "/site.webmanifest",
  "/manifest.webmanifest",
  "/arvys-icons/icon-512.png",
  "/favicon-v3.ico",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (e.request.method !== "GET") return;

  // Tout ce qui touche le backend : réseau uniquement (jamais de cache)
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/v1/") ||
    url.pathname.startsWith("/__") ||
    url.pathname.startsWith("/apk/")
  ) {
    return;
  }

  // Assets de la SPA : cache d'abord (fichiers fingerprintés, immuables)
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ||
          fetch(e.request).then((r) => {
            if (r.ok) {
              const clone = r.clone();
              caches.open(CACHE).then((c) => c.put(e.request, clone));
            }
            return r;
          })
      )
    );
    return;
  }

  // Navigations & coquille : réseau d'abord, repli cache
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) {
          const clone = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return r;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("/")))
  );
});
