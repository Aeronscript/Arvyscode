/* Arvys Code — PWA Client Helper, Guide & Aide Modal, Session Delete & Swipe (shims/pwa.js) */
(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // 1. Définition Globale Immédiate de window.openArvysGuideModal
  // ---------------------------------------------------------------------------
  var isGuideOpen = false;
  window.openArvysGuideModal = function () {
    if (window.__realOpenArvysGuide) {
      window.__realOpenArvysGuide();
    } else {
      window.__arvysPendingGuide = true;
    }
  };
  window.openArvysSecretAnimation = window.openArvysGuideModal;

  // Interception de window.open pour ouvrir le Guide au lieu de pages externes bloquées
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
      window.openArvysGuideModal();
      return null;
    }
    return _rawWindowOpen ? _rawWindowOpen.apply(this, arguments) : null;
  };

  // ---------------------------------------------------------------------------
  // 2. Gestion des erreurs bénignes d'affichage (ResizeObserver & Terminal)
  // ---------------------------------------------------------------------------
  function ignoreBenign(e) {
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
  }
  window.addEventListener("error", ignoreBenign, true);
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
  // 3. Purge proactive des anciens caches Service Worker
  // ---------------------------------------------------------------------------
  if (window.caches) {
    caches.keys().then(function (keys) {
      keys.forEach(function (k) {
        if (k !== "arvys-v5-live") {
          caches.delete(k);
        }
      });
    }).catch(function () {});
  }

  // ---------------------------------------------------------------------------
  // 4. Enregistrement du Service Worker v5
  // ---------------------------------------------------------------------------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then(function (reg) {
          try { reg.update(); } catch (_e) {}
        })
        .catch(function () {});
    });
  }

  // Helper pour exécution sécurisée dès que le DOM est disponible
  function onDomReady(fn) {
    if (document.body) {
      fn();
    } else {
      document.addEventListener("DOMContentLoaded", fn);
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Guide Modal & Gestionnaire des Sessions (Corbeille + Swipe)
  // ---------------------------------------------------------------------------
  onDomReady(function initUi() {
    var guideModalEl = null;
    var confirmModalEl = null;
    var sessionCacheMap = {};

    // Récupération de la liste des sessions pour mapper les IDs
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
    setInterval(refreshSessionsApi, 6000);

    // Injection des styles
    var style = document.createElement("style");
    style.id = "arvys-custom-styles";
    style.textContent = [
      // Page d'Aide & Documentation Plein Écran (Style 100% Natif ArvysCode)
      "#arvys-help-page { position:fixed;inset:0;z-index:999999;display:none;flex-direction:column;width:100%;height:100dvh;background:var(--v2-background-bg-deep,#090a0f);color:var(--v2-text-text-base,#f4f4f5);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;overflow:hidden;box-sizing:border-box }",
      "#arvys-help-page.is-open { display:flex !important }",
      ".arvys-help-header { height:48px;min-height:48px;background:var(--v2-background-bg-layer-01,#111219);border-bottom:1px solid var(--v2-border-border-base,#232635);display:flex;align-items:center;justify-content:space-between;padding:0 12px;flex-shrink:0;gap:8px;box-sizing:border-box }",
      ".arvys-help-header-left { display:flex;align-items:center;gap:6px;min-width:0;flex:1 }",
      ".arvys-help-back-btn { display:inline-flex;align-items:center;gap:4px;background:transparent;border:1px solid var(--v2-border-border-base,#232635);color:var(--v2-text-text-base,#f4f4f5);font-size:12px;font-weight:500;padding:4px 8px;border-radius:6px;cursor:pointer;white-space:nowrap;flex-shrink:0 }",
      ".arvys-help-back-btn:hover { background:var(--v2-overlay-simple-overlay-hover,rgba(255,255,255,0.06));border-color:var(--v2-border-border-strong,#3b3f54) }",
      ".arvys-help-back-btn svg { width:14px;height:14px }",
      ".arvys-help-header-sep { width:1px;height:16px;background:var(--v2-border-border-base,#232635);flex-shrink:0 }",
      ".arvys-help-title-group { display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden }",
      ".arvys-help-logo { width:14px;height:20px;flex-shrink:0 }",
      ".arvys-help-title { font-size:12.5px;font-weight:550;color:var(--v2-text-text-base,#ffffff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0 }",
      ".arvys-help-badge { font-size:10.5px;font-weight:500;color:var(--v2-text-text-muted,#9499ad);background:var(--v2-background-bg-layer-02,#171923);border:1px solid var(--v2-border-border-base,#232635);padding:1px 5px;border-radius:4px;white-space:nowrap }",
      ".arvys-help-header-right { display:flex;align-items:center;gap:6px;flex-shrink:0 }",
      ".arvys-help-action-btn { display:inline-flex;align-items:center;gap:5px;background:var(--v2-background-bg-layer-02,#171923);border:1px solid var(--v2-border-border-base,#232635);color:var(--v2-text-text-base,#ffffff);font-size:12px;font-weight:500;padding:4px 8px;border-radius:6px;text-decoration:none;cursor:pointer;white-space:nowrap }",
      ".arvys-help-action-btn:hover { background:var(--v2-overlay-simple-overlay-hover,#1f2231);color:#ffffff }",
      ".arvys-help-action-btn svg { width:14px;height:14px;color:var(--v2-icon-icon-muted,#9499ad);flex-shrink:0 }",
      ".arvys-help-icon-btn { width:28px;height:28px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;background:transparent;border:1px solid var(--v2-border-border-base,#232635);color:var(--v2-text-text-muted,#9499ad);cursor:pointer;flex-shrink:0 }",
      ".arvys-help-icon-btn:hover { background:var(--v2-overlay-simple-overlay-hover,rgba(255,255,255,0.06));color:var(--v2-text-text-base,#ffffff) }",
      ".arvys-help-icon-btn svg { width:14px;height:14px }",
      "@media (max-width: 720px) { .arvys-help-badge { display:none } .arvys-help-action-btn span { display:none } .arvys-help-action-btn { padding:5px } .arvys-help-title { max-width:90px } }",
      // Corps Défilable
      ".arvys-help-scroll { flex:1;overflow-y:auto;padding:32px 16px 80px;display:flex;justify-content:center;-webkit-overflow-scrolling:touch;box-sizing:border-box }",
      ".arvys-help-content { width:100%;max-width:800px;display:flex;flex-direction:column;gap:28px }",
      ".arvys-help-section { display:flex;flex-direction:column;gap:8px }",
      ".arvys-help-section-title { font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--v2-text-text-muted,#8e93a7);padding-left:2px;margin:0 }",
      // Cartes au format exact des listes Settings d'ArvysCode
      ".arvys-help-card { background:var(--v2-background-bg-layer-01,#111219);border:1px solid var(--v2-border-border-base,#232635);border-radius:8px;overflow:hidden;display:flex;flex-direction:column }",
      ".arvys-help-item { display:flex;gap:14px;padding:16px;border-bottom:1px solid var(--v2-border-border-base,#232635);align-items:flex-start }",
      ".arvys-help-item:last-child { border-bottom:none }",
      ".arvys-help-item-icon { width:32px;height:32px;border-radius:6px;background:var(--v2-background-bg-layer-02,#171923);border:1px solid var(--v2-border-border-base,#232635);display:flex;align-items:center;justify-content:center;color:var(--v2-text-text-base,#ffffff);flex-shrink:0 }",
      ".arvys-help-item-icon svg { width:16px;height:16px }",
      ".arvys-help-item-body { flex:1;display:flex;flex-direction:column;gap:4px;min-width:0 }",
      ".arvys-help-item-title { font-size:13.5px;font-weight:550;color:var(--v2-text-text-base,#ffffff);margin:0 }",
      ".arvys-help-item-desc { font-size:12.5px;line-height:1.55;color:var(--v2-text-text-muted,#9ea3b5);margin:0 }",
      ".arvys-help-item-desc b { color:var(--v2-text-text-base,#ffffff) }",
      ".arvys-help-kbd { display:inline-block;background:var(--v2-background-bg-layer-03,#1f2231);border:1px solid var(--v2-border-border-base,#2b2f42);border-radius:4px;padding:1px 6px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:11.5px;color:var(--v2-text-text-base,#ffffff) }",
      ".arvys-help-inline-btn { display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:500;color:var(--v2-text-text-accent,#60a5fa);background:transparent;border:none;padding:0;margin-top:6px;cursor:pointer;text-decoration:underline;text-underline-offset:3px }",
      ".arvys-help-inline-btn:hover { color:#93c5fd }",
      // Bouton Corbeille Rouge direct
      ".arvys-session-del-btn { opacity:0.85;background:transparent;border:none;color:#ef4444;cursor:pointer;padding:6px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;transition:all .15s;flex-shrink:0;z-index:25 }",
      ".arvys-session-del-btn:hover { opacity:1;background:rgba(239,68,68,0.18);transform:scale(1.15) }",
      ".arvys-session-del-btn svg { width:16px;height:16px;pointer-events:none }",
      // Boîte de dialogue de confirmation (Style standard dialog-v2 ArvysCode)
      "#arvys-confirm-modal { position:fixed;inset:0;z-index:9999999;display:flex;align-items:center;justify-content:center;background:var(--v2-overlay-simple-overlay-scrim,rgba(0,0,0,0.72));opacity:0;pointer-events:none;transition:opacity .18s ease;padding:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif }",
      "#arvys-confirm-modal.is-open { opacity:1;pointer-events:auto }",
      ".arvys-confirm-box { width:min(92vw,410px);background:var(--v2-background-bg-layer-01,#111219);border:1px solid var(--v2-border-border-base,#232635);border-radius:8px;padding:22px;display:flex;flex-direction:column;gap:12px;box-shadow:var(--v2-elevation-overlay,0 20px 48px rgba(0,0,0,0.8));color:var(--v2-text-text-base,#ffffff) }",
      ".arvys-confirm-title { font-size:14.5px;font-weight:550;color:var(--v2-text-text-base,#ffffff);margin:0 }",
      ".arvys-confirm-name { font-size:12px;color:var(--v2-text-text-base,#ffffff);background:var(--v2-background-bg-layer-02,#171923);padding:4px 10px;border-radius:5px;display:inline-block;word-break:break-all;border:1px solid var(--v2-border-border-base,#232635);font-family:ui-monospace,monospace }",
      ".arvys-confirm-desc { font-size:12.5px;color:var(--v2-text-text-muted,#9499ad);line-height:1.5;margin:0 }",
      ".arvys-confirm-actions { display:flex;gap:10px;margin-top:6px }",
      ".arvys-confirm-cancel { flex:1;background:var(--v2-background-bg-layer-02,#171923);border:1px solid var(--v2-border-border-base,#232635);color:var(--v2-text-text-base,#ffffff);padding:8px 14px;border-radius:6px;font-size:13px;cursor:pointer;font-weight:500;transition:background .15s }",
      ".arvys-confirm-cancel:hover { background:var(--v2-overlay-simple-overlay-hover,#1f2231) }",
      ".arvys-confirm-delete { flex:1;background:var(--v2-state-fg-danger,#dc2626);border:none;color:#fff;padding:8px 14px;border-radius:6px;font-size:13px;cursor:pointer;font-weight:600;transition:background .15s }",
      ".arvys-confirm-delete:hover { background:#ef4444 }",
      // Fix 1 Upstream PR #53816 : Full tool error text & no truncation
      "[data-component*='error'], [class*='error'], [class*='tool-error'], [data-slot*='error'] { white-space: pre-wrap !important; word-break: break-word !important; overflow-wrap: break-word !important; max-height: none !important; }",
      // Fix 2 Upstream PR #51781 : Allow touch scrolling in directory picker and modal lists
      "[role='dialog'], [data-component*='picker'], [data-component*='select'], [class*='overflow-y'], [class*='overflow-auto'] { -webkit-overflow-scrolling: touch !important; touch-action: pan-y !important; }",
      // Fix 3 Upstream PR #49461 : Disable submit hover stuck state on touch
      "@media (hover: none) { button:hover, [role='button']:hover, [data-action*='submit']:hover { background-color: unset !important; opacity: 1 !important; transform: none !important; } }"
    ].join("\n");
    document.head.appendChild(style);

    // Construction de la Vraie Page Plein Écran d'Aide & Documentation ArvysCode
    var helpPageEl = document.createElement("div");
    helpPageEl.id = "arvys-help-page";
    helpPageEl.innerHTML = [
      '<header class="arvys-help-header">',
      '  <div class="arvys-help-header-left">',
      '    <button class="arvys-help-back-btn" id="arvys-help-btn-back">',
      '      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 12L6 8L10 4"/></svg>',
      '      <span>Retour</span>',
      '    </button>',
      '    <div class="arvys-help-header-sep"></div>',
      '    <div class="arvys-help-title-group">',
      '      <svg class="arvys-help-logo" viewBox="0 0 18 30" fill="none" xmlns="http://www.w3.org/2000/svg">',
      '        <path d="M12 20H6V12H12V20Z" fill="rgba(255,255,255,0.25)"></path>',
      '        <path d="M0 0h6v6h-6ZM6 0h6v6h-6ZM12 0h6v6h-6ZM0 6h6v6h-6ZM12 6h6v6h-6ZM0 12h6v6h-6ZM6 12h6v6h-6ZM12 12h6v6h-6ZM0 18h6v6h-6ZM12 18h6v6h-6ZM0 24h6v6h-6ZM12 24h6v6h-6Z" fill="#ffffff"></path>',
      '      </svg>',
      '      <h1 class="arvys-help-title">Aide & Guide ArvysCode</h1>',
      '      <span class="arvys-help-badge">Documentation</span>',
      '    </div>',
      '  </div>',
      '  <div class="arvys-help-header-right">',
      '    <button class="arvys-help-action-btn" id="arvys-help-top-settings">',
      '      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8h1.5M13 8h1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"/></svg>',
      '      <span>Paramètres</span>',
      '    </button>',
      '    <a class="arvys-help-action-btn" href="/download">',
      '      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v7.5M5 7.5l3 3 3-3M3 13.5h10"/></svg>',
      '      <span>APK Android</span>',
      '    </a>',
      '    <button class="arvys-help-icon-btn" id="arvys-help-btn-close" title="Fermer">',
      '      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4L4 12M4 4L12 12"/></svg>',
      '    </button>',
      '  </div>',
      '</header>',
      '<main class="arvys-help-scroll">',
      '  <div class="arvys-help-content">',
      '    <div class="arvys-help-section">',
      '      <h2 class="arvys-help-section-title">Agent Autonome & Développeur IA</h2>',
      '      <div class="arvys-help-card">',
      '        <div class="arvys-help-item">',
      '          <div class="arvys-help-item-icon">',
      '            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="10" height="9" rx="2"/><circle cx="6" cy="8" r="1" fill="currentColor"/><circle cx="10" cy="8" r="1" fill="currentColor"/><path d="M8 1.5v2.5M1.5 8.5h1.5M13 8.5h1.5"/></svg>',
      '          </div>',
      '          <div class="arvys-help-item-body">',
      '            <h3 class="arvys-help-item-title">Conception & Modification de code en direct</h3>',
      '            <p class="arvys-help-item-desc">Arvys Code est votre environnement de développement autonome. Décrivez simplement une fonctionnalité, un refactoring ou un bug : l\'agent inspecte l\'arborescence, crée et met à jour les fichiers de code, et gère votre projet de bout en bout.</p>',
      '          </div>',
      '        </div>',
      '        <div class="arvys-help-item">',
      '          <div class="arvys-help-item-icon">',
      '            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5l3.5 3L3 11M8 11h5"/></svg>',
      '          </div>',
      '          <div class="arvys-help-item-body">',
      '            <h3 class="arvys-help-item-title">Terminal & Flux temps réel</h3>',
      '            <p class="arvys-help-item-desc">L\'agent exécute les commandes dans le shell en direct. Les réponses textuelles, logs de build et diffs de code sont diffusés en continu sur votre écran sans qu\'il soit nécessaire d\'actualiser la page.</p>',
      '          </div>',
      '        </div>',
      '      </div>',
      '    </div>',
      '    <div class="arvys-help-section">',
      '      <h2 class="arvys-help-section-title">Modèles IA & Clés Personnelles</h2>',
      '      <div class="arvys-help-card">',
      '        <div class="arvys-help-item">',
      '          <div class="arvys-help-item-icon">',
      '            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2l1.8 3.8L14 6.4l-3 3 .7 4.1L8 11.6l-3.7 1.9.7-4.1-3-3 4.2-.6L8 2z"/></svg>',
      '          </div>',
      '          <div class="arvys-help-item-body">',
      '            <h3 class="arvys-help-item-title">Modèles intégrés offerts</h3>',
      '            <p class="arvys-help-item-desc"><b>arvys-code :</b> Modèle haute intelligence pour la réflexion architecturale et le code complexe (20 requêtes quotidiennes offertes).<br><b>arvys-flash :</b> Modèle ultra-rapide pour des modifications directes instantanées.</p>',
      '          </div>',
      '        </div>',
      '        <div class="arvys-help-item">',
      '          <div class="arvys-help-item-icon">',
      '            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="8" r="3.5"/><path d="M9.5 8h5M12.5 8v2M14.5 8v1.5"/></svg>',
      '          </div>',
      '          <div class="arvys-help-item-body">',
      '            <h3 class="arvys-help-item-title">Utilisation Illimitée avec vos clés API</h3>',
      '            <p class="arvys-help-item-desc">Pour coder sans aucune limite de requêtes, configurez vos clés personnelles (Google Gemini, Groq, OpenAI, Anthropic) directement dans les Paramètres.</p>',
      '            <button class="arvys-help-inline-btn" id="arvys-help-link-keys">Ouvrir la configuration des clés API dans Paramètres ➔</button>',
      '          </div>',
      '        </div>',
      '      </div>',
      '    </div>',
      '    <div class="arvys-help-section">',
      '      <h2 class="arvys-help-section-title">Gestion & Suppression des Sessions</h2>',
      '      <div class="arvys-help-card">',
      '        <div class="arvys-help-item">',
      '          <div class="arvys-help-item-icon">',
      '            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h10M6 4.5V3a1 1 0 011-1h2a1 1 0 011 1v1.5M4 4.5l.7 8.5a1.5 1.5 0 001.5 1.5h3.6a1.5 1.5 0 001.5-1.5L12 4.5"/></svg>',
      '          </div>',
      '          <div class="arvys-help-item-body">',
      '            <h3 class="arvys-help-item-title">Bouton corbeille direct</h3>',
      '            <p class="arvys-help-item-desc">Sur l\'écran d\'Accueil, chaque session affiche une corbeille rouge. Un clic ouvre une confirmation sécurisée pour purger la session et ses fichiers.</p>',
      '          </div>',
      '        </div>',
      '        <div class="arvys-help-item">',
      '          <div class="arvys-help-item-icon">',
      '            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8h12M10 4l4 4-4 4"/></svg>',
      '          </div>',
      '          <div class="arvys-help-item-body">',
      '            <h3 class="arvys-help-item-title">Geste Swipe sur mobile</h3>',
      '            <p class="arvys-help-item-desc">Sur smartphone et tablette, glissez la session vers la droite avec votre doigt pour afficher instantanément la confirmation de suppression.</p>',
      '          </div>',
      '        </div>',
      '      </div>',
      '    </div>',
      '    <div class="arvys-help-section">',
      '      <h2 class="arvys-help-section-title">Application Mobile & PWA</h2>',
      '      <div class="arvys-help-card">',
      '        <div class="arvys-help-item">',
      '          <div class="arvys-help-item-icon">',
      '            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="2" width="7" height="12" rx="1.5"/><circle cx="8" cy="11.5" r=".75" fill="currentColor"/></svg>',
      '          </div>',
      '          <div class="arvys-help-item-body">',
      '            <h3 class="arvys-help-item-title">Android (Package APK officiel)</h3>',
      '            <p class="arvys-help-item-desc">Téléchargez l\'application autonome pour Android via le bouton en haut à droite ou le lien direct pour l\'installer sur votre smartphone.</p>',
      '          </div>',
      '        </div>',
      '        <div class="arvys-help-item">',
      '          <div class="arvys-help-item-icon">',
      '            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8M4 6l4-4 4 4M2 14h12"/></svg>',
      '          </div>',
      '          <div class="arvys-help-item-body">',
      '            <h3 class="arvys-help-item-title">iPhone / iPad (Safari Plein Écran)</h3>',
      '            <p class="arvys-help-item-desc">Dans Safari sur iOS, touchez le bouton Partager ➔ <b>« Sur l\'écran d\'accueil »</b> pour ouvrir ArvysCode en mode plein écran natif sans interface Safari.</p>',
      '          </div>',
      '        </div>',
      '      </div>',
      '    </div>',
      '    <div class="arvys-help-section">',
      '      <h2 class="arvys-help-section-title">Raccourcis Clavier & Navigation</h2>',
      '      <div class="arvys-help-card">',
      '        <div class="arvys-help-item">',
      '          <div class="arvys-help-item-icon">',
      '            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3.5" width="12" height="9" rx="1.5"/><path d="M4.5 6.5h1M7.5 6.5h1M10.5 6.5h1M5 9.5h6"/></svg>',
      '          </div>',
      '          <div class="arvys-help-item-body">',
      '            <h3 class="arvys-help-item-title">Commandes rapides</h3>',
      '            <p class="arvys-help-item-desc"><span class="arvys-help-kbd">Ctrl</span> + <span class="arvys-help-kbd">K</span> ou <span class="arvys-help-kbd">Cmd</span> + <span class="arvys-help-kbd">K</span> : Ouvrir la palette de commandes globale.<br><span class="arvys-help-kbd">Échap</span> : Revenir à l\'écran précédent ou fermer la vue actuelle.</p>',
      '          </div>',
      '        </div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</main>'
    ].join("\n");
    document.body.appendChild(helpPageEl);

    function closeHelp() {
      if (helpPageEl) helpPageEl.classList.remove("is-open");
      isGuideOpen = false;
      document.body.style.overflow = "";
      if (location.hash === "#help") {
        history.replaceState(null, "", location.pathname + location.search);
      }
    }

    function openHelpPage() {
      if (helpPageEl) {
        helpPageEl.classList.add("is-open");
        isGuideOpen = true;
        document.body.style.overflow = "hidden";
        if (location.hash !== "#help") {
          history.pushState({ help: true }, "", "#help");
        }
      }
    }

    function navigateToSettings() {
      closeHelp();
      var btnSettings = document.querySelector('button[name="settings"], [aria-label="settings"], [data-action="settings"]');
      if (btnSettings) {
        btnSettings.click();
      } else {
        location.href = "/settings";
      }
    }

    document.getElementById("arvys-help-btn-back").addEventListener("click", closeHelp);
    document.getElementById("arvys-help-btn-close").addEventListener("click", closeHelp);
    document.getElementById("arvys-help-top-settings").addEventListener("click", navigateToSettings);
    var linkKeys = document.getElementById("arvys-help-link-keys");
    if (linkKeys) linkKeys.addEventListener("click", navigateToSettings);

    window.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isGuideOpen) closeHelp();
    });

    window.addEventListener("popstate", function () {
      if (location.hash !== "#help" && isGuideOpen) {
        closeHelp();
      } else if (location.hash === "#help" && !isGuideOpen) {
        openHelpPage();
      }
    });

    if (location.hash === "#help" || location.pathname === "/help") {
      openHelpPage();
    }

    // Modal de confirmation de suppression
    confirmModalEl = document.createElement("div");
    confirmModalEl.id = "arvys-confirm-modal";
    confirmModalEl.innerHTML = [
      '<div class="arvys-confirm-box">',
      '  <h3 class="arvys-confirm-title">Supprimer définitivement la session ?</h3>',
      '  <div><span class="arvys-confirm-name" id="arvys-confirm-session-name">Session</span></div>',
      '  <p class="arvys-confirm-desc">Tous les messages, l\'historique et les données de cette session seront définitivement effacés. Cette action est irréversible.</p>',
      '  <div class="arvys-confirm-actions">',
      '    <button class="arvys-confirm-cancel" id="arvys-confirm-btn-cancel">Annuler</button>',
      '    <button class="arvys-confirm-delete" id="arvys-confirm-btn-delete">Supprimer</button>',
      '  </div>',
      '</div>'
    ].join("\n");
    document.body.appendChild(confirmModalEl);

    function promptDeleteSession(sessionId, sessionTitle, sessionRowEl) {
      if (!sessionId) return;
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
              if (location.pathname.indexOf(sessionId) !== -1) {
                location.replace("/");
              }
            }
          })
          .catch(function () {});
      };
    }

    // -------------------------------------------------------------------------
    // Injection dynamique des contrôles de suppression sur l'Accueil (Corbeille + Swipe)
    // -------------------------------------------------------------------------
    function attachSessionDeleteControls() {
      var candidates = document.querySelectorAll(
        '[data-component="home-session-row-container"], [data-component="home-session-row"], [data-session-id], a[href*="ses_"]'
      );

      candidates.forEach(function (el) {
        var row = el.closest('[data-component="home-session-row-container"]') || el;
        if (row.getAttribute("data-arvys-del-attached") === "1") return;

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

        if (!sessionId) return;
        row.setAttribute("data-arvys-del-attached", "1");

        // Bouton corbeille s'il n'existe pas déjà
        if (!row.querySelector(".arvys-session-del-btn") && !row.querySelector('[data-action="home-session-delete"]')) {
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

          var reveal = row.querySelector(".hover-reveal") || row.querySelector('[class*="right-1.5"]');
          if (reveal) {
            reveal.style.opacity = "1";
            reveal.appendChild(delBtn);
          } else {
            row.style.position = "relative";
            delBtn.style.position = "absolute";
            delBtn.style.right = "8px";
            delBtn.style.top = "50%";
            delBtn.style.transform = "translateY(-50%)";
            row.appendChild(delBtn);
          }
        }

        // Geste Swipe vers la droite (sur mobile et écran tactile)
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
          if (dx > 20 && dy < 30) {
            isSwiping = true;
            row.style.transform = "translateX(" + Math.min(dx, 85) + "px)";
            row.style.background = "rgba(239, 68, 68, 0.22)";
            row.style.borderRadius = "8px";
          }
        }, { passive: true });

        row.addEventListener("touchend", function (e) {
          if (!isSwiping) return;
          row.style.transition = "transform 0.25s ease, background 0.25s ease";
          row.style.transform = "";
          row.style.background = "";
          var touchEndX = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : 0;
          if (touchEndX - touchStartX > 60) {
            if (navigator.vibrate) try { navigator.vibrate(30); } catch (_v) {}
            promptDeleteSession(sessionId, sessionTitle, row);
          }
        });
      });
    }

    // Observer les changements du DOM pour réattacher si de nouvelles sessions s'affichent
    if (window.MutationObserver) {
      var obs = new MutationObserver(function () {
        attachSessionDeleteControls();
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }
    setInterval(attachSessionDeleteControls, 1000);

    // Définition de l'ouverture réelle de la Page d'Aide ArvysCode
    window.__realOpenArvysGuide = openHelpPage;
    window.openArvysGuideModal = openHelpPage;
    window.openArvysSecretAnimation = openHelpPage;

    if (window.__arvysPendingGuide) {
      window.__arvysPendingGuide = false;
      openHelpPage();
    }

    // -------------------------------------------------------------------------
    // Interception globale des clics sur "Aide" (Exclut formellement Accueil & Paramètres)
    // -------------------------------------------------------------------------
    document.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("button, a, [role='button']") : null;
      if (!btn) return;

      var text = (btn.textContent || "").trim().toLowerCase();
      var nameAttr = (btn.getAttribute("name") || "").toLowerCase();
      var ariaLabel = (btn.getAttribute("aria-label") || "").toLowerCase();
      var href = (btn.getAttribute("href") || "").toLowerCase();

      // NE JAMAIS INTERCEPTER ACCUEIL NI PARAMETRES NI NOUVELLE SESSION
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

      var isHelp =
        text === "aide" ||
        text === "? aide" ||
        text === "help" ||
        text === "? help" ||
        nameAttr === "help" ||
        ariaLabel === "help" ||
        ariaLabel === "aide" ||
        href.indexOf("desktop-feedback") !== -1 ||
        href.indexOf("secret-help") !== -1 ||
        href.indexOf("#arvys-secret") !== -1 ||
        href.indexOf("discord") !== -1;

      if (!isHelp && btn.querySelector) {
        var helpIcon = btn.querySelector('[name="help"], svg[data-icon="help"]');
        if (helpIcon && text.indexOf("param") === -1 && text.indexOf("accue") === -1) {
          isHelp = true;
        }
      }

      if (isHelp) {
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        openHelpPage();
        return false;
      }
    }, true);

    // -------------------------------------------------------------------------
    // 6. Application stricte du vrai logo Arvys Code (Modèles & Favicon)
    // -------------------------------------------------------------------------
    function enforceArvysLogos() {
      // Modèles dans les sélecteurs et listes
      document.querySelectorAll('img[data-component="custom-managed-provider-icon"], img[src*="custom-managed-provider"], img[src*="opencode.ai/favicon"]').forEach(function (img) {
        if (img.getAttribute("src") !== "/icon.svg") {
          img.src = "/icon.svg";
        }
      });
      // Favicon dans <head>
      var fav = document.querySelector('link[rel="icon"]');
      if (fav && fav.getAttribute("href") !== "/favicon.ico" && fav.getAttribute("href") !== "/icon.svg") {
        fav.href = "/favicon.ico";
      }
    }
    enforceArvysLogos();
    setInterval(enforceArvysLogos, 1200);

    // -------------------------------------------------------------------------
    // 7. Fix 1 Upstream PR #53816 : Affichage intégral du texte des erreurs d'outils
    // -------------------------------------------------------------------------
    function expandToolErrors() {
      document.querySelectorAll('[data-component*="error"], [class*="error"], [class*="tool-error"]').forEach(function (el) {
        if (el.style) {
          el.style.maxHeight = "none";
          el.style.whiteSpace = "pre-wrap";
          el.style.wordBreak = "break-word";
        }
      });
    }
    document.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest('[data-component*="error"], [class*="error"], [class*="tool-error"], button') : null;
      if (t) {
        setTimeout(expandToolErrors, 50);
      }
    }, true);
    setInterval(expandToolErrors, 2000);

    // -------------------------------------------------------------------------
    // 8. Fix 2 Upstream PR #51781 : Allow touch scrolling in directory picker
    // -------------------------------------------------------------------------
    function enableTouchScrolling() {
      document.querySelectorAll('[data-component*="picker"], [data-component*="select"], [role="dialog"] div, .overflow-y-auto, .overflow-auto').forEach(function (el) {
        if (el && el.style) {
          el.style.webkitOverflowScrolling = "touch";
          el.style.touchAction = "pan-y";
        }
      });
    }
    document.addEventListener("touchstart", function () {
      enableTouchScrolling();
    }, { passive: true });
    setInterval(enableTouchScrolling, 3000);

    // -------------------------------------------------------------------------
    // 9. Fix 3 Upstream PR #49461 : Disable submit hover stuck state on touch
    // -------------------------------------------------------------------------
    document.addEventListener("touchend", function (e) {
      var btn = e.target.closest ? e.target.closest("button, [role='button'], [data-action*='submit']") : null;
      if (btn) {
        btn.blur();
        setTimeout(function () {
          btn.blur();
        }, 50);
      }
    }, { passive: true });

    // -------------------------------------------------------------------------
    // 10. Redirection automatique du dossier projet par défaut vers /workspace
    // -------------------------------------------------------------------------
    function patchDirectoryPicker() {
      var inputs = document.querySelectorAll('input[type="text"], input:not([type])');
      inputs.forEach(function (input) {
        var val = input.value || input.defaultValue || "";
        if (val === "/app/applet" || val === "/app" || val.includes("/app/applet")) {
          input.value = "/workspace";
          if (input.defaultValue) input.defaultValue = "/workspace";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
      document.querySelectorAll('*').forEach(function (el) {
        if (el.children.length === 0 && (el.textContent === "/app/applet" || el.textContent === "app/applet")) {
          el.textContent = "/workspace";
        }
      });
    }
    setInterval(patchDirectoryPicker, 300);
    document.addEventListener("click", function () {
      setTimeout(patchDirectoryPicker, 50);
      setTimeout(patchDirectoryPicker, 200);
    }, true);

    // -------------------------------------------------------------------------
    // 11. Importation de dossier depuis l'appareil du client
    // -------------------------------------------------------------------------
    var importInput = document.createElement("input");
    importInput.type = "file";
    importInput.webkitdirectory = true;
    importInput.directory = true;
    importInput.multiple = true;
    importInput.style.display = "none";
    document.body.appendChild(importInput);

    importInput.addEventListener("change", async function (e) {
      var files = e.target.files;
      if (!files || files.length === 0) return;
      
      var firstPath = files[0].webkitRelativePath || files[0].name;
      var folderName = firstPath.split("/")[0] || "mon-projet-" + Date.now().toString(36);
      
      var toast = document.createElement("div");
      toast.style.cssText = "position:fixed;bottom:24px;right:24px;z-index:999999;background:#111219;color:#fff;border:1px solid #232635;padding:12px 18px;border-radius:8px;font:13px -apple-system,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,0.5)";
      toast.textContent = "📁 Importation de " + files.length + " fichiers (" + folderName + ")...";
      document.body.appendChild(toast);

      var payloadFiles = [];
      for (var i = 0; i < files.length; i++) {
        var file = files[i];
        var relPath = file.webkitRelativePath || file.name;
        var cleanPath = relPath.includes("/") ? relPath.split("/").slice(1).join("/") : relPath;
        if (!cleanPath) cleanPath = file.name;

        await new Promise(function (resolve) {
          var reader = new FileReader();
          var isText = file.type.startsWith("text/") || /\.(js|ts|tsx|jsx|json|md|css|html|py|sh|yml|yaml|txt|gitignore)$/i.test(file.name);
          if (isText) {
            reader.onload = function (evt) {
              payloadFiles.push({ path: cleanPath, content: evt.target.result, encoding: "utf8" });
              resolve();
            };
            reader.readAsText(file);
          } else {
            reader.onload = function (evt) {
              var base64 = evt.target.result.split(",")[1] || "";
              payloadFiles.push({ path: cleanPath, content: base64, encoding: "base64" });
              resolve();
            };
            reader.readAsDataURL(file);
          }
        });
      }

      try {
        var res = await fetch("/api/arvys/import-folder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderName: folderName, files: payloadFiles })
        });
        var data = await res.json();
        if (data.success) {
          toast.textContent = "✅ Dossier importé avec succès ! Ouverture...";
          setTimeout(function () {
            toast.remove();
            window.location.reload();
          }, 1000);
        } else {
          throw new Error(data.error || "Échec");
        }
      } catch (err) {
        toast.textContent = "❌ Erreur d'importation : " + (err.message || err);
        setTimeout(function () { toast.remove(); }, 4000);
      }
      importInput.value = "";
    });

    function injectImportButton() {
      var modal = document.querySelector('[role="dialog"], .dialog-content, div[class*="dialog"]');
      if (modal && !modal.querySelector("#arvys-import-btn")) {
        var container = modal.querySelector('input[type="text"], input:not([type]), div[class*="content"], div[class*="body"]');
        if (container) {
          var parentBox = container.closest('div[class*="content"], div[class*="body"], div[class*="dialog"]') || modal;
          var btn = document.createElement("button");
          btn.id = "arvys-import-btn";
          btn.type = "button";
          btn.style.cssText = "background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:#fff;padding:11px 18px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;font-weight:600;font-size:13.5px;border:none;width:100%;margin-bottom:14px;box-shadow:0 4px 14px rgba(59,130,246,0.35);transition:transform .15s;";
          btn.innerHTML = '📁 Importer un dossier depuis mon appareil';
          btn.onmouseover = function() { btn.style.transform = "translateY(-1px)"; };
          btn.onmouseout = function() { btn.style.transform = "none"; };
          btn.onclick = function () {
            importInput.click();
          };
          var firstChild = parentBox.firstElementChild;
          if (firstChild) {
            parentBox.insertBefore(btn, firstChild);
          } else {
            parentBox.appendChild(btn);
          }
        }
      }
    }
    setInterval(injectImportButton, 300);
  });
})();
