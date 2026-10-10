/* Arvys Code — Badge quota IA + message de rétablissement (shims/quota.js)
 * Affiche « X/20 » (messages IA restants aujourd'hui) dans un pilule flottante,
 * intercepte les 429 du backend (quota journalier atteint) et affiche un toast
 * avec l'heure de réinitialisation (00:00 UTC, convertie en heure locale).
 * Zéro dépendance, jamais d'exception remontée à l'app. */
(function () {
  "use strict";
  if (window.__arvysQuota) return;
  window.__arvysQuota = 1;

  var STATUS_URL = "/__status";
  var POLL_MS = 60000;

  // ---------- état ----------
  var state = { limit: 0, remaining: -1, last: 0 };

  function fmtResetHour() {
    try {
      var n = new Date();
      var next = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1, 0, 0, 0));
      return next.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch (e) { return "00:00 UTC"; }
  }
  function fmtCountdown() {
    try {
      var n = new Date();
      var next = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1, 0, 0, 0));
      var s = Math.max(0, Math.floor((next - n) / 1000));
      var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
      return h > 0 ? (h + " h " + (m < 10 ? "0" : "") + m) : (m + " min");
    } catch (e) { return ""; }
  }

  // ---------- styles (variables UI v2 + replis) ----------
  var CSS = [
    "#arvys-quota-pill { position:fixed; z-index:999997; top:calc(env(safe-area-inset-top,0px) + 52px); right:calc(env(safe-area-inset-right,0px) + 10px);",
    "display:none; align-items:center; gap:5px; padding:3px 9px; border-radius:999px; cursor:pointer; user-select:none; -webkit-user-select:none;",
    "background:var(--v2-background-bg-layer-01,#111219); border:1px solid var(--v2-border-border-base,#232635);",
    "color:var(--v2-text-text-base,#f4f4f5); font:600 11px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;",
    "box-shadow:0 2px 10px rgba(0,0,0,.35); opacity:.92; white-space:nowrap }",
    "#arvys-quota-pill .dot { width:6px;height:6px;border-radius:99px;background:#34d399;flex-shrink:0 }",
    "#arvys-quota-pill.low .dot { background:#fbbf24 }",
    "#arvys-quota-pill.out { border-color:#7f1d1d; background:#2a1214 }",
    "#arvys-quota-pill.out .dot { background:#ef4444 }",
    "#arvys-quota-pill.out { color:#fecaca }",
    "#arvys-quota-tip { position:fixed; z-index:999998; top:calc(env(safe-area-inset-top,0px) + 84px); right:calc(env(safe-area-inset-right,0px) + 10px);",
    "display:none; max-width:240px; padding:10px 12px; border-radius:10px;",
    "background:var(--v2-background-bg-layer-01,#111219); border:1px solid var(--v2-border-border-base,#232635);",
    "color:var(--v2-text-text-base,#f4f4f5); font:400 12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;",
    "box-shadow:0 6px 24px rgba(0,0,0,.45) }",
    "#arvys-quota-tip b { font-weight:600 }",
    "#arvys-quota-tip .muted { color:var(--v2-text-text-muted,#9499ad) }",
    "#arvys-quota-toast { position:fixed; z-index:999999; left:50%; transform:translateX(-50%);",
    "bottom:calc(env(safe-area-inset-bottom,0px) + 18px); display:none; max-width:min(92vw,420px);",
    "padding:11px 14px; border-radius:12px; text-align:center;",
    "background:#2a1214; border:1px solid #7f1d1d; color:#fecaca;",
    "font:500 13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; box-shadow:0 8px 30px rgba(0,0,0,.5) }"
  ].join("");

  function mount() {
    if (document.getElementById("arvys-quota-style")) return;
    var st = document.createElement("style");
    st.id = "arvys-quota-style";
    st.textContent = CSS;
    document.head.appendChild(st);

    var pill = document.createElement("div");
    pill.id = "arvys-quota-pill";
    pill.innerHTML = '<span class="dot"></span><span class="txt">…</span>';
    pill.addEventListener("click", toggleTip);
    document.body.appendChild(pill);

    var tip = document.createElement("div");
    tip.id = "arvys-quota-tip";
    document.body.appendChild(tip);

    var toast = document.createElement("div");
    toast.id = "arvys-quota-toast";
    document.body.appendChild(toast);

    document.addEventListener("click", function (e) {
      if (!tip.style.display || tip.style.display === "none") return;
      if (e.target === pill || pill.contains(e.target) || tip.contains(e.target)) return;
      tip.style.display = "none";
    });
  }
  function $(id) { return document.getElementById(id); }

  function render() {
    var pill = $("arvys-quota-pill"); if (!pill) return;
    if (state.remaining < 0 || !state.limit) { pill.style.display = "none"; return; }
    var r = state.remaining;
    pill.className = r === 0 ? "out" : (r <= Math.max(2, Math.ceil(state.limit * 0.15)) ? "low" : "");
    pill.querySelector(".txt").textContent = r + "/" + state.limit;
    pill.style.display = "flex";
    pill.title = "Messages IA restants aujourd'hui";
  }
  function renderTip() {
    var tip = $("arvys-quota-tip"); if (!tip) return;
    if (state.remaining < 0 || !state.limit) { tip.style.display = "none"; return; }
    var used = Math.max(0, state.limit - state.remaining);
    tip.innerHTML =
      "<b>Quota IA du jour</b><br>" +
      used + " message" + (used > 1 ? "s" : "") + " utilisé" + (used > 1 ? "s" : "") +
      " sur " + state.limit + "<br>" +
      "<span class='muted'>Reviens à " + fmtResetHour() +
      " (00:00 UTC" + (fmtCountdown() ? " — dans " + fmtCountdown() : "") + ")</span>";
    tip.style.display = "block";
  }
  function toggleTip() {
    var tip = $("arvys-quota-tip"); if (!tip) return;
    if (tip.style.display === "block") { tip.style.display = "none"; return; }
    renderTip();
  }

  var toastTimer = null;
  function showToast(msg) {
    var t = $("arvys-quota-toast"); if (!t) return;
    t.textContent = msg;
    t.style.display = "block";
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.style.display = "none"; }, 9000);
  }

  // ---------- données ----------
  function refresh() {
    fetch(STATUS_URL, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var q = d && d.gateway && d.gateway.health && d.gateway.health.quota;
        if (q && typeof q.limit === "number" && typeof q.remaining === "number") {
          state.limit = q.limit; state.remaining = q.remaining; state.last = Date.now();
        } else {
          state.remaining = -1; // passerelle absente ou quota non exposé : pilule masquée
        }
        render();
      })
      .catch(function () { });
  }

  // ---------- interception 429 ----------
  var origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function () {
      var args = arguments;
      return origFetch.apply(this, args).then(function (res) {
        try {
          var url = "";
          try { url = (res && res.url) || (args[0] && args[0].url) || String(args[0] || ""); } catch (e) { }
          if (res && res.status === 429 && (/\/v1\//.test(url) || /\/api\//.test(url))) {
            state.remaining = 0; render(); renderTip();
            showToast("Quota du jour atteint (" + state.limit + "/" + state.limit + ") — l'IA revient à " + fmtResetHour() + ". Tes projets restent accessibles.");
          }
        } catch (e) { }
        return res;
      });
    };
  }

  function start() {
    try { mount(); } catch (e) { }
    refresh();
    setInterval(refresh, POLL_MS);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") refresh();
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
