/* Arvys Code — PWA Client Helper, Install Prompts, Offline UX & Cache (shims/pwa.js) */
(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // 0. Interception de window.open pour bloquer les redirections Discord / Aide
  // ---------------------------------------------------------------------------
  window.openArvysGuideModal = function () {
    if (window.__realOpenArvysGuide) {
      window.__realOpenArvysGuide();
    } else {
      window.__arvysPendingGuide = true;
    }
  };
  window.openArvysSecretAnimation = window.openArvysGuideModal;

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
      if (window.openArvysGuideModal) {
        window.openArvysGuideModal();
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
  // 6. Guide & Présentation Officielle Arvys Code (Remplace l'animation d'aide)
  // ---------------------------------------------------------------------------
  (function initArvysGuideAndSessionManager() {
    var guideModalEl = null;
    var confirmModalEl = null;
    var sessionCacheMap = {}; // mapping title/key -> session object

    // Récupération périodique des sessions de l'API pour mapper les IDs
    function refreshSessionsApi() {
      if (!window.fetch) return;
      fetch("/api/session", { credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          var list = (res && res.data) || [];
          list.forEach(function (s) {
            if (s && s.id) {
              sessionCacheMap[s.id] = s;
              if (s.title) sessionCacheMap[s.title.trim().toLowerCase()] = s;
            }
          });
        })
        .catch(function () {});
    }
    refreshSessionsApi();
    setInterval(refreshSessionsApi, 8000);

    function ensureGuideModal() {
      if (guideModalEl) return;

      var style = document.createElement("style");
      style.textContent = [
        "#arvys-guide-modal { position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.78);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);opacity:0;pointer-events:none;transition:opacity .25s ease;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:16px;color:#ececec }",
        "#arvys-guide-modal.is-open { opacity:1;pointer-events:auto }",
        ".arvys-guide-sheet { position:relative;width:min(94vw,500px);max-height:88vh;overflow-y:auto;background:#0d0e14;border:1px solid #242738;border-radius:20px;box-shadow:0 24px 64px rgba(0,0,0,0.9);padding:24px 22px;display:flex;flex-direction:column;gap:16px;box-sizing:border-box }",
        ".arvys-guide-header { display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #1f2232;padding-bottom:16px }",
        ".arvys-guide-brand { display:flex;align-items:center;gap:12px }",
        ".arvys-guide-logo { width:28px;height:42px;flex-shrink:0 }",
        ".arvys-guide-brand h2 { font-size:17px;font-weight:700;color:#fff;margin:0 }",
        ".arvys-guide-brand span { font-size:11px;color:#00ff88;font-weight:600;background:rgba(0,255,136,0.1);padding:3px 8px;border-radius:99px;border:1px solid rgba(0,255,136,0.25) }",
        ".arvys-guide-close { background:#161822;border:1px solid #2a2e40;color:#999;width:32px;height:32px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:15px;transition:all .15s }",
        ".arvys-guide-close:hover { color:#fff;background:#262a3c }",
        ".arvys-guide-card { background:#12141c;border:1px solid #1e2230;border-radius:14px;padding:15px;display:flex;flex-direction:column;gap:7px }",
        ".arvys-guide-card-title { font-size:13.5px;font-weight:700;color:#fff;display:flex;align-items:center;gap:8px }",
        ".arvys-guide-card-p { font-size:12.5px;color:#a4a8bc;line-height:1.5;margin:0 }",
        ".arvys-guide-card-p b { color:#fff }",
        ".arvys-guide-actions { display:flex;gap:10px;margin-top:6px }",
        ".arvys-guide-btn-done { flex:1;background:#e8e8e8;color:#08090d;font-weight:700;border:none;border-radius:10px;padding:12px;font-size:13.5px;cursor:pointer;text-align:center;transition:background .15s }",
        ".arvys-guide-btn-done:hover { background:#ffffff }",
        ".arvys-guide-btn-dl { flex:1;background:#181b26;border:1px solid #2c3144;color:#38bdf8;font-weight:600;border-radius:10px;padding:12px;font-size:13px;cursor:pointer;text-align:center;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:6px }",
        ".arvys-guide-btn-dl:hover { background:#222636;color:#fff }",
        // Styles pour la Corbeille et Swipe sur les sessions
        ".arvys-session-del-btn { opacity:0.65;background:transparent;border:none;color:#ff5555;cursor:pointer;padding:6px 8px;margin-left:auto;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;transition:opacity .15s,background .15s,transform .15s;flex-shrink:0;z-index:10 }",
        ".arvys-session-del-btn:hover { opacity:1;background:rgba(255,85,85,0.18);transform:scale(1.1) }",
        ".arvys-session-del-btn svg { width:15px;height:15px;pointer-events:none }",
        // Boîte de dialogue de confirmation
        "#arvys-confirm-modal { position:fixed;inset:0;z-index:9999999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.75);backdrop-filter:blur(10px);opacity:0;pointer-events:none;transition:opacity .2s ease;padding:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif }",
        "#arvys-confirm-modal.is-open { opacity:1;pointer-events:auto }",
        ".arvys-confirm-box { width:min(90vw,380px);background:#101218;border:1px solid #282c3c;border-radius:16px;padding:22px 20px;display:flex;flex-direction:column;gap:14px;box-shadow:0 20px 48px rgba(0,0,0,.9);color:#fff;text-align:center }",
        ".arvys-confirm-title { font-size:16px;font-weight:700;color:#fff }",
        ".arvys-confirm-name { font-size:13px;color:#38bdf8;background:rgba(56,189,248,0.1);padding:4px 10px;border-radius:8px;display:inline-block;margin:0 auto;word-break:break-all;border:1px solid rgba(56,189,248,0.2) }",
        ".arvys-confirm-desc { font-size:12.8px;color:#9b9ea0;line-height:1.45 }",
        ".arvys-confirm-actions { display:flex;gap:10px;margin-top:6px }",
        ".arvys-confirm-cancel { flex:1;background:#1a1d26;border:1px solid #2c3040;color:#ccc;padding:11px;border-radius:9px;font-size:13px;cursor:pointer;font-weight:600;transition:background .15s }",
        ".arvys-confirm-cancel:hover { background:#242836;color:#fff }",
        ".arvys-confirm-delete { flex:1;background:#d32f2f;border:none;color:#fff;padding:11px;border-radius:9px;font-size:13px;cursor:pointer;font-weight:700;transition:background .15s;box-shadow:0 4px 14px rgba(211,47,47,0.35) }",
        ".arvys-confirm-delete:hover { background:#f44336 }"
      ].join("\n");
      document.head.appendChild(style);

      guideModalEl = document.createElement("div");
      guideModalEl.id = "arvys-guide-modal";
      guideModalEl.innerHTML = [
        '<div class="arvys-guide-sheet">',
        '  <div class="arvys-guide-header">',
        '    <div class="arvys-guide-brand">',
        '      <svg class="arvys-guide-logo" viewBox="0 0 18 30" fill="none" xmlns="http://www.w3.org/2000/svg">',
        '        <path d="M12 20H6V12H12V20Z" fill="rgba(255,255,255,0.3)"></path>',
        '        <path d="M0 0h6v6h-6ZM6 0h6v6h-6ZM12 0h6v6h-6ZM0 6h6v6h-6ZM12 6h6v6h-6ZM0 12h6v6h-6ZM6 12h6v6h-6ZM12 12h6v6h-6ZM0 18h6v6h-6ZM12 18h6v6h-6ZM0 24h6v6h-6ZM12 24h6v6h-6Z" fill="#ffffff"></path>',
        '      </svg>',
        '      <div><h2>Arvys Code</h2><span>v1.2 • Environnement Autonome</span></div>',
        '    </div>',
        '    <button class="arvys-guide-close" id="arvys-guide-btn-close">✕</button>',
        '  </div>',
        '  <div class="arvys-guide-card">',
        '    <div class="arvys-guide-card-title">🤖 Agent IA Autonome</div>',
        '    <p class="arvys-guide-card-p">Arvys Code est votre environnement de développement autonome complet. Il analyse votre arborescence, crée et modifie des fichiers, exécute des commandes bash et résout vos bugs de manière fluide et autonome.</p>',
        '  </div>',
        '  <div class="arvys-guide-card">',
        '    <div class="arvys-guide-card-title">⚡ Modèles IA & Quotas</div>',
        '    <p class="arvys-guide-card-p"><b>arvys-code :</b> Modèle puissant pour le raisonnement approfondi et l\'architecture (20 requêtes gratuites offertes chaque jour).<br><b>arvys-flash :</b> Réponses et modifications ultra-rapides pour coder sans attente.<br><b>Clés API Personnelles :</b> Rendez-vous dans <i>Paramètres</i> pour ajouter vos clés (Gemini, Groq, OpenAI, Anthropic...) et coder en illimité.</p>',
        '  </div>',
        '  <div class="arvys-guide-card">',
        '    <div class="arvys-guide-card-title">🗑️ Suppression Complète de Session</div>',
        '    <p class="arvys-guide-card-p">Pour supprimer définitivement une session : cliquez sur l\'icône corbeille 🗑️ à droite de la session, ou effectuez un <b>glissement vers la droite (Swipe)</b> sur mobile avec confirmation de sécurité.</p>',
        '  </div>',
        '  <div class="arvys-guide-card">',
        '    <div class="arvys-guide-card-title">📱 Installation Mobile Réelle</div>',
        '    <p class="arvys-guide-card-p"><b>Android :</b> Fichier APK officiel autonome (4.2 Mo) ou installation directe WebAPK.<br><b>iPhone / iPad :</b> Safari ➔ Partager ⎋ ➔ « Sur l\'écran d\'accueil » pour l\'exécuter en plein écran natif sans interface de navigateur.</p>',
        '  </div>',
        '  <div class="arvys-guide-actions">',
        '    <a class="arvys-guide-btn-dl" href="/download">📥 Page Téléchargement</a>',
        '    <button class="arvys-guide-btn-done" id="arvys-guide-btn-done">Compris</button>',
        '  </div>',
        '</div>'
      ].join("\n");

      document.body.appendChild(guideModalEl);

      function closeGuide() {
        if (guideModalEl) guideModalEl.classList.remove("is-open");
      }
      document.getElementById("arvys-guide-btn-close").addEventListener("click", closeGuide);
      document.getElementById("arvys-guide-btn-done").addEventListener("click", closeGuide);
      guideModalEl.addEventListener("click", function (e) {
        if (e.target === guideModalEl) closeGuide();
      });
      window.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && guideModalEl && guideModalEl.classList.contains("is-open")) {
          closeGuide();
        }
      });
    }

    function openGuideModal() {
      ensureGuideModal();
      if (guideModalEl) guideModalEl.classList.add("is-open");
    }

    // Modal de confirmation de suppression de session
    function ensureConfirmModal() {
      if (confirmModalEl) return;
      confirmModalEl = document.createElement("div");
      confirmModalEl.id = "arvys-confirm-modal";
      confirmModalEl.innerHTML = [
        '<div class="arvys-confirm-box">',
        '  <div class="arvys-confirm-title">Supprimer définitivement la session ?</div>',
        '  <div class="arvys-confirm-name" id="arvys-confirm-session-name">Session</div>',
        '  <div class="arvys-confirm-desc">Tous les messages, l\'historique et les données de cette session seront définitivement effacés de la base de données. Cette action est irréversible.</div>',
        '  <div class="arvys-confirm-actions">',
        '    <button class="arvys-confirm-cancel" id="arvys-confirm-btn-cancel">Annuler</button>',
        '    <button class="arvys-confirm-delete" id="arvys-confirm-btn-delete">Supprimer définitivement</button>',
        '  </div>',
        '</div>'
      ].join("\n");
      document.body.appendChild(confirmModalEl);
    }

    function promptDeleteSession(sessionId, sessionTitle, sessionRowEl) {
      if (!sessionId) return;
      ensureConfirmModal();
      var nameEl = document.getElementById("arvys-confirm-session-name");
      if (nameEl) nameEl.textContent = sessionTitle || sessionId;
      confirmModalEl.classList.add("is-open");

      var btnCancel = document.getElementById("arvys-confirm-btn-cancel");
      var btnDelete = document.getElementById("arvys-confirm-btn-delete");

      var cleanup = function () {
        confirmModalEl.classList.remove("is-open");
        btnCancel.onclick = null;
        btnDelete.onclick = null;
      };

      btnCancel.onclick = cleanup;
      btnDelete.onclick = function () {
        cleanup();
        fetch("/api/session/" + sessionId, { method: "DELETE", credentials: "same-origin" })
          .then(function (r) {
            if (r.ok || r.status === 200 || r.status === 204) {
              if (sessionRowEl) {
                sessionRowEl.style.transition = "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)";
                sessionRowEl.style.opacity = "0";
                sessionRowEl.style.transform = "translateX(60px)";
                sessionRowEl.style.maxHeight = "0";
                sessionRowEl.style.overflow = "hidden";
                sessionRowEl.style.padding = "0";
                sessionRowEl.style.margin = "0";
                setTimeout(function () {
                  if (sessionRowEl.parentNode) sessionRowEl.parentNode.removeChild(sessionRowEl);
                }, 320);
              }
              // Si nous étions actuellement sur cette session, retourner à l'accueil
              if (location.pathname.indexOf(sessionId) !== -1) {
                location.replace("/");
              }
            }
          })
          .catch(function () {});
      };
    }

    // -------------------------------------------------------------------------
    // Injection automatique de l'icône Corbeille & Swipe sur chaque session
    // -------------------------------------------------------------------------
    function attachSessionDeleteControls() {
      var candidates = document.querySelectorAll(
        '[data-component="home-session-row-container"], [data-component="home-session-row"], [data-session-id], a[href*="ses_"], [data-component="home-session-search-row"]'
      );

      candidates.forEach(function (el) {
        var row = el.closest('[data-component="home-session-row-container"]') || el;
        if (row.getAttribute("data-arvys-del-attached") === "1") return;

        // Déterminer le sessionId et titre
        var sessionId = row.getAttribute("data-session-id") || el.getAttribute("data-session-id");
        var sessionTitle = row.getAttribute("data-session-title") || "";

        if (!sessionId) {
          var href = el.getAttribute("href") || row.getAttribute("href") || "";
          var m = href.match(/ses_[a-zA-Z0-9_-]+/);
          if (m) sessionId = m[0];
        }

        if (!sessionId) {
          var titleEl = row.querySelector('[data-component="home-session-title"]') || row;
          var t = (titleEl.textContent || "").trim();
          if (t && sessionCacheMap[t.toLowerCase()]) {
            var cached = sessionCacheMap[t.toLowerCase()];
            sessionId = cached.id;
            sessionTitle = cached.title || t;
          }
        }

        // Si nous avons toujours pas d'ID, réessayons au prochain cycle
        if (!sessionId) return;
        row.setAttribute("data-arvys-del-attached", "1");

        // 1. Bouton corbeille
        var delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "arvys-session-del-btn";
        delBtn.title = "Supprimer définitivement cette session";
        delBtn.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>' +
          '<line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';

        delBtn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (e.stopImmediatePropagation) e.stopImmediatePropagation();
          promptDeleteSession(sessionId, sessionTitle, row);
        });

        // Insérer le bouton corbeille dans le container
        var hoverReveal = row.querySelector(".hover-reveal");
        if (hoverReveal) {
          hoverReveal.style.opacity = "1";
          hoverReveal.appendChild(delBtn);
        } else {
          row.style.position = "relative";
          row.appendChild(delBtn);
        }

        // 2. Geste Swipe vers la droite pour supprimer (tactile mobile)
        var touchStartX = 0;
        var touchStartY = 0;
        var isSwiping = false;

        row.addEventListener("touchstart", function (e) {
          if (!e.touches || !e.touches[0]) return;
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
          isSwiping = false;
        }, { passive: true });

        row.addEventListener("touchmove", function (e) {
          if (!e.touches || !e.touches[0]) return;
          var dx = e.touches[0].clientX - touchStartX;
          var dy = Math.abs(e.touches[0].clientY - touchStartY);
          if (dx > 25 && dy < 35) {
            isSwiping = true;
            row.style.transform = "translateX(" + Math.min(dx, 85) + "px)";
            row.style.background = "rgba(239, 68, 68, 0.18)";
            row.style.borderRadius = "8px";
          }
        }, { passive: true });

        row.addEventListener("touchend", function (e) {
          if (!isSwiping) return;
          row.style.transition = "transform 0.25s ease, background 0.25s ease";
          row.style.transform = "";
          row.style.background = "";
          var touchEndX = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : 0;
          if (touchEndX - touchStartX > 65) {
            if (navigator.vibrate) try { navigator.vibrate(25); } catch (_v) {}
            promptDeleteSession(sessionId, sessionTitle, row);
          }
        });
      });
    }

    // Observer pour injecter dès que la liste des sessions change
    if (window.MutationObserver) {
      var obs = new MutationObserver(function () {
        attachSessionDeleteControls();
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }
    setInterval(attachSessionDeleteControls, 1200);

    // Export global
    window.openArvysSecretAnimation = openGuideModal;
    window.openArvysGuideModal = openGuideModal;

    // -------------------------------------------------------------------------
    // Interception STRICTE du bouton Aide uniquement (Exclut Accueil & Paramètres !)
    // -------------------------------------------------------------------------
    document.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("button, a, [role='button']") : null;
      if (!btn) return;

      var text = (btn.textContent || "").trim().toLowerCase();
      var nameAttr = (btn.getAttribute("name") || "").toLowerCase();
      var ariaLabel = (btn.getAttribute("aria-label") || "").toLowerCase();
      var href = (btn.getAttribute("href") || "").toLowerCase();

      // EXCLUSION FORMELLE : Ne jamais intercepter Accueil ni Paramètres !
      if (
        text.indexOf("accueil") !== -1 ||
        text.indexOf("home") !== -1 ||
        text.indexOf("paramètre") !== -1 ||
        text.indexOf("settings") !== -1 ||
        text.indexOf("nouvelle session") !== -1 ||
        nameAttr === "settings" ||
        ariaLabel === "settings" ||
        ariaLabel === "accueil"
      ) {
        return;
      }

      // CIBLE STRICTE : Uniquement le bouton Aide / Help / Forum / Support
      var isDirectHelp =
        text === "aide" ||
        text === "? aide" ||
        text === "help" ||
        text === "? help" ||
        nameAttr === "help" ||
        ariaLabel === "help" ||
        ariaLabel === "aide" ||
        href.indexOf("desktop-feedback") !== -1 ||
        href.indexOf("discord") !== -1 ||
        href.indexOf("secret-help") !== -1 ||
        href.indexOf("#arvys-secret") !== -1;

      if (!isDirectHelp && btn.querySelector) {
        var helpIcon = btn.querySelector('[name="help"], svg[data-icon="help"]');
        if (helpIcon && text.indexOf("param") === -1 && text.indexOf("accue") === -1) {
          isDirectHelp = true;
        }
      }

      if (isDirectHelp) {
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        openGuideModal();
        return false;
      }
    }, true);
  })();
})();


