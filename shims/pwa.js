/* Arvys Code — PWA Client Helper, Install Prompts, Offline UX & Cache (shims/pwa.js) */
(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // 0. Interception de window.open pour bloquer les redirections Discord / Aide
  // ---------------------------------------------------------------------------
  var _rawWindowOpen = window.open;
  window.open = function (url, target, features) {
    var u = String(url || "");
    if (
      u.indexOf("secret-help") !== -1 ||
      u.indexOf("secret-protocol") !== -1 ||
      u.indexOf("desktop-feedback") !== -1 ||
      u.indexOf("discord.com") !== -1 ||
      u.indexOf("discord.gg") !== -1 ||
      u.indexOf("#arvys-secret") !== -1
    ) {
      if (window.openArvysSecretAnimation) {
        window.openArvysSecretAnimation();
      } else {
        window.__arvysPendingSecretOpen = true;
      }
      return null;
    }
    return _rawWindowOpen ? _rawWindowOpen.apply(this, arguments) : null;
  };

  // ---------------------------------------------------------------------------
  // 0b. Gestion des erreurs bénignes d'affichage (ResizeObserver & Terminal)
  // ---------------------------------------------------------------------------
  window.addEventListener("error", function (e) {
    var msg = (e && (e.message || (e.error && e.error.message))) || "";
    if (
      msg.indexOf("ResizeObserver") !== -1 ||
      msg.indexOf("ResizeObserver loop") !== -1 ||
      msg.indexOf("Failed to clone terminal") !== -1 ||
      msg.indexOf("Transport: Failed to fetch") !== -1
    ) {
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      if (e.preventDefault) e.preventDefault();
      return true;
    }
  }, true);

  window.addEventListener("unhandledrejection", function (e) {
    var msg = (e && e.reason && (e.reason.message || String(e.reason))) || "";
    if (
      msg.indexOf("ResizeObserver") !== -1 ||
      msg.indexOf("ResizeObserver loop") !== -1 ||
      msg.indexOf("Failed to clone terminal") !== -1 ||
      msg.indexOf("Transport: Failed to fetch") !== -1
    ) {
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      if (e.preventDefault) e.preventDefault();
      return true;
    }
  }, true);

  // ---------------------------------------------------------------------------
  // 1. Détection Client Desktop (Sécurité C2)
  // ---------------------------------------------------------------------------
  try {
    var isDesktopOverride =
      location.search.indexOf("desktop=1") !== -1 ||
      localStorage.getItem("arvysAllowDesktop") === "1";
    var isMobileUA = /iPhone|iPad|iPod|Android.*Mobile|Mobile.*Android|Windows Phone/i.test(
      navigator.userAgent
    );
    var isDesktopScreen =
      window.matchMedia &&
      window.matchMedia("(hover: hover) and (pointer: fine)").matches &&
      window.innerWidth >= 820;

    var currentPath = location.pathname;
    var isExcludedPath =
      currentPath === "/download" ||
      currentPath === "/desktop-block.html" ||
      currentPath === "/offline.html" ||
      currentPath === "/sw.js" ||
      currentPath.indexOf("/__") === 0 ||
      currentPath.indexOf("/apk/") === 0;

    if (!isDesktopOverride && !isMobileUA && isDesktopScreen && !isExcludedPath) {
      location.replace("/desktop-block.html");
      return;
    }
  } catch (e) {}

  // ---------------------------------------------------------------------------
  // 2. Enregistrement du Service Worker v3
  // ---------------------------------------------------------------------------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then(function (reg) {
          console.log("[Arvys PWA] Service Worker v3 actif — scope:", reg.scope);
        })
        .catch(function (err) {
          console.warn("[Arvys PWA] Échec enregistrement SW:", err);
        });
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Gestion de l'installation Android / Chrome (beforeinstallprompt)
  // ---------------------------------------------------------------------------
  window.__arvysDeferredPrompt = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    window.__arvysDeferredPrompt = e;
    window.dispatchEvent(new CustomEvent("arvys-pwa-installable"));
    showInstallBanner();
  });

  window.addEventListener("appinstalled", function () {
    window.__arvysDeferredPrompt = null;
    hideInstallBanner();
    console.log("[Arvys PWA] Application installée avec succès");
  });

  function isStandalone() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true ||
      document.referrer.includes("android-app://")
    );
  }

  // Verrouillage iOS Standalone (conserve l'application dans sa fenêtre autonome)
  if (window.navigator.standalone === true) {
    document.addEventListener("click", function (e) {
      var a = e.target && e.target.closest ? e.target.closest("a") : null;
      if (a && a.href && a.hostname === location.hostname && !a.target && !a.hasAttribute("download")) {
        e.preventDefault();
        location.assign(a.href);
      }
    }, false);
  }

  function showInstallBanner() {
    if (isStandalone()) return;
    if (sessionStorage.getItem("arvysDismissInstallBanner") === "1") return;
    if (document.getElementById("arvys-install-banner")) return;
    if (location.pathname === "/download" || location.pathname === "/desktop-block.html") return;

    var banner = document.createElement("div");
    banner.id = "arvys-install-banner";
    banner.style.cssText =
      "position:fixed;bottom:16px;left:16px;right:16px;max-width:420px;margin:0 auto;background:#111;border:1px solid #282828;border-radius:14px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;box-shadow:0 12px 32px rgba(0,0,0,.7);z-index:99999;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";

    banner.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;">' +
      '<div style="width:36px;height:36px;border-radius:8px;background:#0d0d0d;border:1px solid #333;display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
      '<svg viewBox="0 0 512 512" width="22" height="22"><rect x="142" y="66" width="76" height="76" fill="#f5f5f5"/><rect x="218" y="66" width="76" height="76" fill="#f5f5f5"/><rect x="294" y="66" width="76" height="76" fill="#f5f5f5"/><rect x="142" y="142" width="76" height="76" fill="#f5f5f5"/><rect x="294" y="142" width="76" height="76" fill="#f5f5f5"/><rect x="142" y="218" width="76" height="76" fill="#f5f5f5"/><rect x="218" y="218" width="76" height="76" fill="#f5f5f5"/><rect x="294" y="218" width="76" height="76" fill="#f5f5f5"/><rect x="142" y="294" width="76" height="76" fill="#f5f5f5"/><rect x="294" y="294" width="76" height="76" fill="#f5f5f5"/><rect x="142" y="370" width="76" height="76" fill="#f5f5f5"/><rect x="294" y="370" width="76" height="76" fill="#f5f5f5"/></svg>' +
      '</div>' +
      '<div>' +
      '<div style="font-size:13.5px;font-weight:600;color:#fff;">Installer Arvys Code</div>' +
      '<div style="font-size:11.5px;color:#888;">Accès plein écran sur votre écran d\'accueil</div>' +
      '</div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;">' +
      '<button id="arvys-btn-install" style="background:#f5f5f5;color:#0a0a0a;border:none;border-radius:8px;padding:7px 12px;font-size:12.5px;font-weight:600;cursor:pointer;">Installer</button>' +
      '<button id="arvys-btn-dismiss" style="background:transparent;color:#777;border:none;font-size:16px;cursor:pointer;padding:4px 6px;">✕</button>' +
      '</div>';

    document.body.appendChild(banner);

    var btnInstall = document.getElementById("arvys-btn-install");
    var btnDismiss = document.getElementById("arvys-btn-dismiss");

    if (btnInstall) {
      btnInstall.addEventListener("click", function () {
        if (window.__arvysDeferredPrompt) {
          window.__arvysDeferredPrompt.prompt();
          window.__arvysDeferredPrompt.userChoice.then(function () {
            window.__arvysDeferredPrompt = null;
            hideInstallBanner();
          });
        } else {
          location.href = "/download";
        }
      });
    }

    if (btnDismiss) {
      btnDismiss.addEventListener("click", function () {
        sessionStorage.setItem("arvysDismissInstallBanner", "1");
        hideInstallBanner();
      });
    }
  }

  function hideInstallBanner() {
    var banner = document.getElementById("arvys-install-banner");
    if (banner) banner.remove();
  }

  // ---------------------------------------------------------------------------
  // 4. Bannière Hors-Ligne & Supervision Réseau (Travail D1 & D3)
  // ---------------------------------------------------------------------------
  var offlineBanner = null;

  function updateOnlineStatus() {
    var isOnline = navigator.onLine;
    if (!offlineBanner) {
      offlineBanner = document.createElement("div");
      offlineBanner.id = "arvys-network-status";
      offlineBanner.style.cssText =
        "position:fixed;top:12px;left:50%;transform:translateX(-50%);border-radius:99px;padding:5px 14px;font-size:12px;font-weight:500;z-index:99999;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:none;align-items:center;gap:6px;box-shadow:0 6px 16px rgba(0,0,0,.6);transition:all .25s ease;";
      document.body.appendChild(offlineBanner);
    }

    if (!isOnline) {
      offlineBanner.style.background = "#1c1917";
      offlineBanner.style.border = "1px solid #44403c";
      offlineBanner.style.color = "#fef08a";
      offlineBanner.innerHTML =
        '<span style="width:7px;height:7px;border-radius:50%;background:#eab308;box-shadow:0 0 6px rgba(234,179,8,.8);"></span> Mode hors-ligne — terminal local actif';
      offlineBanner.style.display = "inline-flex";
    } else {
      if (offlineBanner.style.display === "inline-flex") {
        offlineBanner.style.background = "#052e16";
        offlineBanner.style.border = "1px solid #166534";
        offlineBanner.style.color = "#bbf7d0";
        offlineBanner.innerHTML =
          '<span style="width:7px;height:7px;border-radius:50%;background:#22c55e;"></span> Connecté — synchronisation…';
        setTimeout(function () {
          if (offlineBanner) offlineBanner.style.display = "none";
        }, 2200);

        // Reprise automatique des flux (Travail D3)
        window.dispatchEvent(new CustomEvent("arvys-network-restored"));
      }
    }
  }

  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", updateOnlineStatus);
  } else {
    updateOnlineStatus();
  }

  // ---------------------------------------------------------------------------
  // 5. Cache au fil de l'eau dans IndexedDB (Travail D2)
  // ---------------------------------------------------------------------------
  var DB_NAME = "arvys_offline_db";
  var STORE_NAME = "api_cache";

  function openOfflineDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error("No indexedDB"));
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function (e) {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "url" });
        }
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
  }

  function storeApiResponse(url, data) {
    openOfflineDb()
      .then(function (db) {
        var tx = db.transaction(STORE_NAME, "readwrite");
        var store = tx.objectStore(STORE_NAME);
        store.put({ url: url, data: data, updated_at: Date.now() });
      })
      .catch(function () {});
  }

  // Interception Fetch pour mise en cache transparente des sessions
  if (window.fetch) {
    var originalFetch = window.fetch;
    window.fetch = function (input, init) {
      var urlStr = typeof input === "string" ? input : input && input.url ? input.url : "";
      var isCacheableApi =
        urlStr.indexOf("/api/session") !== -1 ||
        urlStr.indexOf("/api/config") !== -1;

      return originalFetch.apply(this, arguments).then(function (response) {
        if (
          isCacheableApi &&
          response &&
          response.ok &&
          (!init || !init.method || init.method.toUpperCase() === "GET")
        ) {
          try {
            var clone = response.clone();
            clone.json().then(function (data) {
              storeApiResponse(urlStr, data);
            }).catch(function () {});
          } catch (e) {}
        }
        return response;
      });
    };
  }

  // ---------------------------------------------------------------------------
  // 6. Animation Secrète Arvys (HUD Cyber In-Page, fluide, épuré, centré et non-bloquant)
  // ---------------------------------------------------------------------------
  (function initArvysSecretProtocol() {
    var overlayEl = null;
    var hudEl = null;
    var dismissTimer = null;

    function ensureUi() {
      if (overlayEl) return;

      var style = document.createElement("style");
      style.textContent = [
        "#arvys-secret-overlay { position:fixed;inset:0;pointer-events:none;z-index:999999;display:flex;align-items:center;justify-content:center;padding:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }",
        ".arvys-laser-border { position:fixed;inset:0;pointer-events:none;border:1.5px solid transparent;opacity:0;transition:opacity 0.3s ease; }",
        ".arvys-laser-border.active { opacity:1;border-color:rgba(0,255,136,0.3);box-shadow:inset 0 0 24px rgba(0,255,136,0.06); }",
        ".arvys-hud-box { position:relative;width:min(88vw,340px);background:rgba(10,12,16,0.96);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(0,255,136,0.35);box-shadow:0 20px 48px rgba(0,0,0,0.8),0 0 24px rgba(0,255,136,0.12);border-radius:14px;padding:22px 20px 18px;display:flex;flex-direction:column;align-items:center;text-align:center;color:#fff;opacity:0;transform:scale(0.92);transition:all 0.35s cubic-bezier(0.16,1,0.3,1);pointer-events:none; }",
        ".arvys-hud-box.visible { opacity:1;transform:scale(1); }",
        ".arvys-hud-logo-wrap { width:38px;height:48px;margin-bottom:12px;display:flex;align-items:center;justify-content:center; }",
        ".arvys-hud-logo-wrap svg { width:22px;height:36px;filter:drop-shadow(0 0 8px rgba(255,255,255,0.4)); }",
        ".arvys-hud-tag { display:inline-flex;align-items:center;gap:5px;background:rgba(0,255,136,0.1);color:#00ff88;border:1px solid rgba(0,255,136,0.3);font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:6px;letter-spacing:0.8px;margin-bottom:8px;text-transform:uppercase; }",
        ".arvys-hud-title { font-size:16px;font-weight:700;letter-spacing:-0.2px;color:#ffffff;margin-bottom:4px; }",
        ".arvys-hud-desc { font-size:12px;color:#8f9098;line-height:1.45;max-width:270px; }",
        ".arvys-hud-line { width:100%;height:1px;background:linear-gradient(90deg,transparent,rgba(0,255,136,0.3),transparent);margin-top:14px; }"
      ].join("\n");
      document.head.appendChild(style);

      overlayEl = document.createElement("div");
      overlayEl.id = "arvys-secret-overlay";
      overlayEl.innerHTML = [
        '<div class="arvys-laser-border" id="arvys-border"></div>',
        '<div class="arvys-hud-box" id="arvys-hud">',
        '  <div class="arvys-hud-logo-wrap">',
        '    <svg viewBox="0 0 18 30" fill="none" xmlns="http://www.w3.org/2000/svg">',
        '      <path d="M12 20H6V12H12V20Z" fill="rgba(255,255,255,0.3)"></path>',
        '      <path d="M0 0h6v6h-6ZM6 0h6v6h-6ZM12 0h6v6h-6ZM0 6h6v6h-6ZM12 6h6v6h-6ZM0 12h6v6h-6ZM6 12h6v6h-6ZM12 12h6v6h-6ZM0 18h6v6h-6ZM12 18h6v6h-6ZM0 24h6v6h-6ZM12 24h6v6h-6Z" fill="#ffffff"></path>',
        '    </svg>',
        '  </div>',
        '  <div class="arvys-hud-tag">Protocole Secret Arvys</div>',
        '  <div class="arvys-hud-title">Système 100% Local Actif</div>',
        '  <div class="arvys-hud-desc">Compagnon de codage autonome. Vos fichiers et votre code restent sur votre machine sans dépendance externe.</div>',
        '  <div class="arvys-hud-line"></div>',
        '</div>'
      ].join("\n");

      document.body.appendChild(overlayEl);
      hudEl = document.getElementById("arvys-hud");
    }

    function triggerSecretProtocol() {
      ensureUi();

      var borderEl = document.getElementById("arvys-border");
      if (borderEl) {
        borderEl.classList.add("active");
        setTimeout(function () {
          if (borderEl) borderEl.classList.remove("active");
        }, 1200);
      }

      if (hudEl) {
        hudEl.classList.add("visible");
      }

      if (dismissTimer) clearTimeout(dismissTimer);
      dismissTimer = setTimeout(function () {
        if (hudEl) hudEl.classList.remove("visible");
      }, 2400);
    }

    // Export global
    window.openArvysSecretAnimation = function () {
      triggerSecretProtocol();
    };

    if (window.__arvysPendingSecretOpen) {
      window.__arvysPendingSecretOpen = false;
      setTimeout(triggerSecretProtocol, 50);
    }

    // -------------------------------------------------------------------------
    // Interception globale sur Aide / Help / Discord
    // -------------------------------------------------------------------------
    document.addEventListener("click", function (e) {
      var target = e.target;
      while (target && target !== document.body) {
        var href = target.getAttribute && (target.getAttribute("href") || "");
        var text = (target.textContent || "").trim().toLowerCase();
        var nameAttr = target.getAttribute && (target.getAttribute("name") || "");
        var ariaLabel = target.getAttribute && (target.getAttribute("aria-label") || "").toLowerCase();
        var dataAction = target.getAttribute && (target.getAttribute("data-action") || "").toLowerCase();

        var isDiscordHref =
          href.indexOf("discord.com") !== -1 ||
          href.indexOf("discord.gg") !== -1 ||
          href.indexOf("desktop-feedback") !== -1 ||
          href.indexOf("secret-help") !== -1 ||
          href.indexOf("#arvys-secret") !== -1;

        var isHelpOrDiscord =
          isDiscordHref ||
          nameAttr === "help" ||
          nameAttr === "discord" ||
          dataAction === "help" ||
          dataAction === "discord" ||
          ariaLabel === "help" ||
          ariaLabel === "aide" ||
          text === "aide" ||
          text === "help" ||
          text === "support forum" ||
          text === "forum d'entraide" ||
          (text.indexOf("aide") !== -1 && text.length < 25) ||
          (text.indexOf("help") !== -1 && text.length < 25) ||
          (text.indexOf("discord") !== -1 && text.length < 30);

        if (!isHelpOrDiscord && target.querySelector) {
          var icon = target.querySelector('[name="help"], [name="discord"], svg[data-icon="help"]');
          if (icon) isHelpOrDiscord = true;
        }

        if (isHelpOrDiscord) {
          e.preventDefault();
          e.stopPropagation();
          if (e.stopImmediatePropagation) e.stopImmediatePropagation();
          triggerSecretProtocol();
          return false;
        }
        target = target.parentElement;
      }
    }, true);
  })();
})();


