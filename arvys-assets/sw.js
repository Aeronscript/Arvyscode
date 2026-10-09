/* Arvys Code — Service Worker v5-live (PWA Offline Réelle & Mise à Jour Immédiate) */
const CACHE_NAME = "arvys-v5-live";
const PRECACHE_SHELL = [
  "/",
  "/download",
  "/offline.html",
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
// Activation : purge immédiate de TOUS les anciens caches (arvys-v1, v2, v3, etc.)
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
// 2. Chunks JS/CSS : Network-First pour toujours avoir le code à jour
// 3. Navigations HTML : Network-First avec fallback cache puis offline.html
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

  // Chunks Vite/Next & assets d'interface : Network-First pour garantir la fraîcheur
  if (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/_assets/") ||
    url.pathname.startsWith("/__proxy/") ||
    url.pathname.startsWith("/arvys-icons/")
  ) {
    event.respondWith(
      fetch(req)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return response;
        })
        .catch(() => caches.match(req))
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
            .then((res) => {
              if (res) resolve(res);
              else resolve(fetch(req));
            })
            .catch(() => resolve(caches.match("/offline.html")));
        }, 3000);

        fetch(req)
          .then((response) => {
            if (!timedOut) {
              clearTimeout(timer);
              if (response && response.status === 200) {
                const copy = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
              }
              resolve(response);
            }
          })
          .catch((err) => {
            if (!timedOut) {
              clearTimeout(timer);
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
                .catch(() => resolve(caches.match("/offline.html")));
            }
          });
      })
    );
    return;
  }

  // Pour toutes les autres ressources : Network-First avec fallback Cache
  event.respondWith(
    fetch(req)
      .then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return response;
      })
      .catch(() => caches.match(req))
  );
});

// ---------------------------------------------------------------------------
// Messages depuis les pages (contrôle, skipWaiting, ping)
// ---------------------------------------------------------------------------
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
