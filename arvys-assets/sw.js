/* Arvys Code — Service Worker v3 (PWA Offline Réelle) */
const CACHE_NAME = "arvys-v3";
const PRECACHE_SHELL = [
  "/",
  "/download",
  "/offline.html",
  "/desktop-block.html",
  "/manifest.json",
  "/favicon.ico",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-512-maskable.png",
  "/icon.svg",
  "/wordmark-inline.svg",
  "/mark-inline.svg",
  "/__proxy/pwa.js",
  "/__proxy/bridge.js",
  "/__proxy/voice.js",
  "/__proxy/qrcode.js",
  "/__ptybridge/shim.js",
];

// ---------------------------------------------------------------------------
// Installation : precache de la coquille applicative & activation immédiate
// ---------------------------------------------------------------------------
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.allSettled(
          PRECACHE_SHELL.map((url) =>
            cache.add(new Request(url, { cache: "reload" })).catch((err) => {
              console.warn(`[sw] Precache ignore: ${url}`, err.message);
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

// ---------------------------------------------------------------------------
// Activation : purge des anciens caches (arvys-v1, arvys-v2, workbox, etc.)
// ---------------------------------------------------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => {
              console.log(`[sw] Purge de l'ancien cache: ${key}`);
              return caches.delete(key);
            })
        )
      )
      .then(() => {
        // Nettoyage éventuel du marqueur legacy __ocSWctl dans IndexedDB
        if (typeof indexedDB !== "undefined" && indexedDB.deleteDatabase) {
          try {
            indexedDB.deleteDatabase("__ocSWctl");
          } catch (e) {}
        }
      })
      .then(() => self.clients.claim())
  );
});

// ---------------------------------------------------------------------------
// Fetch : stratégies fines
// 1. /api/*, /v1/*, /__* : réseau pur, jamais interceptés (SSE, PTY, vocal)
// 2. /assets/* : cache-first (chunks fingerprintés immuables)
// 3. Navigations HTML : network-first (timeout 3s) -> cache -> /offline.html
// ---------------------------------------------------------------------------
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Uniquement même origine
  if (url.origin !== location.origin) return;

  // Uniquement requêtes GET (POST, PUT, DELETE, PATCH passent directement au réseau)
  if (req.method !== "GET") return;

  // RÈGLE D'OR TEMPS RÉEL : Ne JAMAIS intercepter les API, ponts SSE, PTY, vocal, diagnostics
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/v1/") ||
    url.pathname.startsWith("/__") ||
    url.pathname.startsWith("/apk/") ||
    url.pathname === "/sw.js"
  ) {
    return;
  }

  // Chunks Vite/Next fingerprintés & icônes statiques : Cache-First
  if (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/_assets/") ||
    url.pathname.startsWith("/arvys-icons/")
  ) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return response;
        });
      })
    );
    return;
  }

  // Navigations utilisateur (pages HTML) : Network-First avec timeout 3s
  const isNav =
    req.mode === "navigate" ||
    (req.headers.get("accept") &&
      req.headers.get("accept").includes("text/html"));

  if (isNav) {
    event.respondWith(
      new Promise((resolve, reject) => {
        let timer = null;
        let timedOut = false;

        timer = setTimeout(() => {
          timedOut = true;
          caches
            .match(req)
            .then((hit) => {
              if (hit) return hit;
              return caches.match("/").then((rootHit) => {
                if (rootHit) return rootHit;
                return caches.match("/offline.html");
              });
            })
            .then((fallback) => {
              if (fallback) resolve(fallback);
              else reject(new Error("Timeout sans cache"));
            })
            .catch(reject);
        }, 3000);

        fetch(req)
          .then((res) => {
            if (timer) clearTimeout(timer);
            if (!timedOut) {
              if (res && res.status === 200) {
                const copy = res.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
              }
              resolve(res);
            }
          })
          .catch((err) => {
            if (timer) clearTimeout(timer);
            if (!timedOut) {
              caches
                .match(req)
                .then((hit) => {
                  if (hit) return hit;
                  return caches.match("/").then((rootHit) => {
                    if (rootHit) return rootHit;
                    return caches.match("/offline.html");
                  });
                })
                .then((fallback) => {
                  if (fallback) resolve(fallback);
                  else reject(err);
                })
                .catch(() => reject(err));
            }
          });
      })
    );
    return;
  }

  // Autres ressources GET (images, favicons, manifests, shims) : Stale-while-revalidate / Cache-First
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
