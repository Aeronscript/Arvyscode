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
      "#arvys-guide-modal { position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.8);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);opacity:0;pointer-events:none;transition:opacity .2s ease;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:16px;color:#ececec }",
      "#arvys-guide-modal.is-open { opacity:1;pointer-events:auto }",
      ".arvys-guide-sheet { position:relative;width:min(95vw,520px);max-height:88vh;overflow-y:auto;background:#0d0e14;border:1px solid #242738;border-radius:20px;box-shadow:0 24px 64px rgba(0,0,0,0.95);padding:24px 22px;display:flex;flex-direction:column;gap:15px;box-sizing:border-box }",
      ".arvys-guide-header { display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #1f2232;padding-bottom:14px }",
      ".arvys-guide-brand { display:flex;align-items:center;gap:12px }",
      ".arvys-guide-logo { width:28px;height:42px;flex-shrink:0 }",
      ".arvys-guide-brand h2 { font-size:17px;font-weight:700;color:#fff;margin:0 }",
      ".arvys-guide-brand span { font-size:11px;color:#00ff88;font-weight:600;background:rgba(0,255,136,0.1);padding:3px 8px;border-radius:99px;border:1px solid rgba(0,255,136,0.25) }",
      ".arvys-guide-close { background:#161822;border:1px solid #2a2e40;color:#aaa;width:32px;height:32px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:15px;transition:all .15s }",
      ".arvys-guide-close:hover { color:#fff;background:#262a3c }",
      ".arvys-guide-card { background:#12141c;border:1px solid #1e2230;border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:6px }",
      ".arvys-guide-card-title { font-size:13.5px;font-weight:700;color:#fff;display:flex;align-items:center;gap:8px }",
      ".arvys-guide-card-p { font-size:12.5px;color:#a4a8bc;line-height:1.55;margin:0 }",
      ".arvys-guide-card-p b { color:#fff }",
      ".arvys-guide-actions { display:flex;gap:10px;margin-top:6px }",
      ".arvys-guide-btn-done { flex:1;background:#ffffff;color:#08090d;font-weight:700;border:none;border-radius:10px;padding:12px;font-size:13.5px;cursor:pointer;text-align:center;transition:background .15s }",
      ".arvys-guide-btn-done:hover { background:#e2e2e2 }",
      ".arvys-guide-btn-dl { flex:1;background:#181b26;border:1px solid #2c3144;color:#38bdf8;font-weight:600;border-radius:10px;padding:12px;font-size:13px;cursor:pointer;text-align:center;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:6px }",
      ".arvys-guide-btn-dl:hover { background:#222636;color:#fff }",
      // Styles pour le Bouton Corbeille Rouge visible
      ".arvys-session-del-btn { opacity:0.85;background:transparent;border:none;color:#ef4444;cursor:pointer;padding:6px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;transition:all .15s;flex-shrink:0;z-index:25 }",
      ".arvys-session-del-btn:hover { opacity:1;background:rgba(239,68,68,0.18);transform:scale(1.15) }",
      ".arvys-session-del-btn svg { width:16px;height:16px;pointer-events:none }",
      // Boîte de dialogue de confirmation
      "#arvys-confirm-modal { position:fixed;inset:0;z-index:9999999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.8);backdrop-filter:blur(12px);opacity:0;pointer-events:none;transition:opacity .2s ease;padding:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif }",
      "#arvys-confirm-modal.is-open { opacity:1;pointer-events:auto }",
      ".arvys-confirm-box { width:min(90vw,400px);background:#101218;border:1px solid #282c3c;border-radius:18px;padding:24px 20px;display:flex;flex-direction:column;gap:14px;box-shadow:0 24px 56px rgba(0,0,0,.95);color:#fff;text-align:center }",
      ".arvys-confirm-title { font-size:16.5px;font-weight:700;color:#fff }",
      ".arvys-confirm-name { font-size:13px;color:#38bdf8;background:rgba(56,189,248,0.1);padding:4px 10px;border-radius:8px;display:inline-block;margin:0 auto;word-break:break-all;border:1px solid rgba(56,189,248,0.2) }",
      ".arvys-confirm-desc { font-size:13px;color:#9b9ea0;line-height:1.45 }",
      ".arvys-confirm-actions { display:flex;gap:10px;margin-top:6px }",
      ".arvys-confirm-cancel { flex:1;background:#1a1d26;border:1px solid #2c3040;color:#ccc;padding:11px;border-radius:10px;font-size:13px;cursor:pointer;font-weight:600;transition:background .15s }",
      ".arvys-confirm-cancel:hover { background:#242836;color:#fff }",
      ".arvys-confirm-delete { flex:1;background:#dc2626;border:none;color:#fff;padding:11px;border-radius:10px;font-size:13px;cursor:pointer;font-weight:700;transition:background .15s;box-shadow:0 4px 14px rgba(220,38,38,0.4) }",
      ".arvys-confirm-delete:hover { background:#ef4444 }"
    ].join("\n");
    document.head.appendChild(style);

    // Construction du Guide Modal
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
      '      <div><h2>Arvys Code</h2><span>Guide & Centre d\'Aide</span></div>',
      '    </div>',
      '    <button class="arvys-guide-close" id="arvys-guide-btn-close">✕</button>',
      '  </div>',
      '  <div class="arvys-guide-card">',
      '    <div class="arvys-guide-card-title">🤖 Agent Autonome</div>',
      '    <p class="arvys-guide-card-p">Arvys Code est votre environnement de développement autonome. Posez une question, demandez une nouvelle fonctionnalité ou signalez un bug : l\'agent analyse le projet, crée et modifie les fichiers de code, et exécute les commandes dans le terminal en direct.</p>',
      '  </div>',
      '  <div class="arvys-guide-card">',
      '    <div class="arvys-guide-card-title">⚡ Modèles IA & Clés API Personnelles</div>',
      '    <p class="arvys-guide-card-p"><b>arvys-code :</b> Raisonnement approfondi et architecture (20 requêtes gratuites offertes chaque jour).<br><b>arvys-flash :</b> Réponses et modifications instantanées pour coder sans délai.<br><b>Clés API Personnelles :</b> Cliquez sur <i>Paramètres</i> (roue crantée ⚙️) pour renseigner vos clés Gemini, Groq, OpenAI ou Anthropic et coder sans aucune limite de quota.</p>',
      '  </div>',
      '  <div class="arvys-guide-card">',
      '    <div class="arvys-guide-card-title">🗑️ Suppression Complète de Session</div>',
      '    <p class="arvys-guide-card-p">Sur l\'Accueil :<br>• Cliquez sur la <b>corbeille rouge 🗑️</b> visible sur chaque session.<br>• Sur mobile tactile, faites un <b>Swipe vers la droite</b> avec le doigt pour déclencher la suppression avec confirmation sécurisée.</p>',
      '  </div>',
      '  <div class="arvys-guide-card">',
      '    <div class="arvys-guide-card-title">📱 Installation Mobile & PWA</div>',
      '    <p class="arvys-guide-card-p"><b>Android :</b> Fichier APK autonome officiel disponible en téléchargement direct.<br><b>iPhone / iPad :</b> Dans Safari, Partager ⎋ ➔ « Sur l\'écran d\'accueil » pour profiter du mode natif plein écran sans barre de navigation.</p>',
      '  </div>',
      '  <div class="arvys-guide-actions">',
      '    <a class="arvys-guide-btn-dl" href="/download">📥 Télécharger APK</a>',
      '    <button class="arvys-guide-btn-done" id="arvys-guide-btn-done">Compris</button>',
      '  </div>',
      '</div>'
    ].join("\n");
    document.body.appendChild(guideModalEl);

    function closeGuide() {
      if (guideModalEl) guideModalEl.classList.remove("is-open");
      isGuideOpen = false;
    }
    document.getElementById("arvys-guide-btn-close").addEventListener("click", closeGuide);
    document.getElementById("arvys-guide-btn-done").addEventListener("click", closeGuide);
    guideModalEl.addEventListener("click", function (e) {
      if (e.target === guideModalEl) closeGuide();
    });
    window.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isGuideOpen) closeGuide();
    });

    function openGuideModal() {
      if (guideModalEl) {
        guideModalEl.classList.add("is-open");
        isGuideOpen = true;
      }
    }

    // Modal de confirmation de suppression
    confirmModalEl = document.createElement("div");
    confirmModalEl.id = "arvys-confirm-modal";
    confirmModalEl.innerHTML = [
      '<div class="arvys-confirm-box">',
      '  <div class="arvys-confirm-title">Supprimer définitivement la session ?</div>',
      '  <div class="arvys-confirm-name" id="arvys-confirm-session-name">Session</div>',
      '  <div class="arvys-confirm-desc">Tous les messages, l\'historique et les données de cette session seront définitivement effacés. Cette action est irréversible.</div>',
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

    // Définition de l'ouverture réelle
    window.__realOpenArvysGuide = openGuideModal;
    window.openArvysGuideModal = openGuideModal;
    window.openArvysSecretAnimation = openGuideModal;

    if (window.__arvysPendingGuide) {
      window.__arvysPendingGuide = false;
      openGuideModal();
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
        openGuideModal();
        return false;
      }
    }, true);
  });
})();
