#!/usr/bin/env node
/**
 * ARVYS CODE — cœur applicatif (proxy-core)
 *
 * Rôle :
 *  - spawn + supervise le binaire ARVYS (OpenCode natif, jamais modifié) :3001
 *  - spawn + supervise la passerelle z.ai (gateway/arvys_zai_gateway.js) :3002
 *  - sert TOUT le HTTP public : anti-cache, rebranding complet (aucun
 *    « OpenCode » visible), ponts SSE & terminal (long-polling), vocal v4+ASR,
 *    page /download, APK, icônes, diagnostics /__status.
 *
 * Fonctionne sous Node >= 22 (global WebSocket) et sous Bun.
 * Framing HTTP strict : aucune en-tête hop-by-hop relayée, Content-Length
 * exact sur les corps rebrandés — lisibilité garantie par tous les runtimes
 * (le fetch Bun du miroir Next rejette les réponses chunked mal cadrées).
 */
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");

const LISTEN_PORT = parseInt(process.env.PROXY_CORE_PORT || process.env.PORT || "3000", 10);
const UPSTREAM_HOST = "127.0.0.1";
const UPSTREAM_PORT = parseInt(process.env.OC_PORT || "3001", 10);
const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || "3002", 10);
const ROOT = __dirname;

// Chemins publics des couches embarquées
const BRIDGE_PATH = "/__proxy/bridge.js";
const VOICE_PATH = "/__proxy/voice.js";
const ASR_PATH = "/__proxy/asr";
const EVENTS_PATH = "/__proxy/events";
const PTY_BRIDGE = "/__ptybridge";
const PTY_SHIM_PATH = PTY_BRIDGE + "/shim.js";
const NUKE_PATH = "/__proxy/nuke.js";

// ---------------------------------------------------------------------------
// Journal annulaire + stats de spawn (diagnostics /__status)
// ---------------------------------------------------------------------------
const LOG_RING = [];
const LOG_MAX = 200;
function ring(line) {
  LOG_RING.push(line);
  if (LOG_RING.length > LOG_MAX) LOG_RING.splice(0, LOG_RING.length - LOG_MAX);
}
function log(msg) {
  const line = `[proxy ${new Date().toISOString()}] ${msg}`;
  ring(line);
  console.log(line);
}
const origError = console.error.bind(console);
console.error = (...a) => {
  try {
    const line = `[err] ${a.map((x) => (typeof x === "string" ? x : (x && x.stack) || String(x))).join(" ")}`;
    ring(line);
  } catch (e) {}
  origError(...a);
};

const SPAWN_STATS = {};
function statsOf(name) {
  if (!SPAWN_STATS[name]) SPAWN_STATS[name] = { attempts: 0, alive: false, pid: null, lastExit: null, lastError: null, cmd: null };
  return SPAWN_STATS[name];
}

function portBusy(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    const done = (v) => { try { s.destroy(); } catch (e) {} resolve(v); };
    s.on("connect", () => done(true));
    s.on("error", () => done(false));
    setTimeout(() => done(true), 700);
  });
}

function keepAlive(name, cmd, args, opts = {}) {
  const st = statsOf(name);
  st.attempts += 1;
  st.cmd = [cmd, ...args].join(" ");
  let child;
  try {
    child = require("node:child_process").spawn(cmd, args, { cwd: opts.cwd || ROOT, stdio: ["ignore", "pipe", "pipe"], env: opts.env ? { ...process.env, ...opts.env } : undefined });
  } catch (e) {
    st.lastError = e && e.message;
    log(`[${name}] spawn impossible : ${e && e.message}`);
    return;
  }
  st.alive = true;
  st.pid = child.pid;
  log(`[${name}] spawné : ${cmd} (${args.join(" ")})`);
  const feed = (rd, tag) => {
    let buf = "";
    rd.on("data", (c) => {
      buf += c.toString("utf8");
      let i;
      while ((i = buf.indexOf("\n")) !== -1) {
        const l = buf.slice(0, i).trimEnd();
        buf = buf.slice(i + 1);
        if (l) log(`[${name}] ${l}`);
      }
    });
    rd.on("error", () => {});
  };
  feed(child.stdout, "out");
  feed(child.stderr, "err");
  child.on("error", (e) => { st.lastError = e && e.message; log(`[${name}] erreur : ${e && e.message}`); });
  child.on("exit", (code) => {
    st.alive = false;
    st.lastExit = code;
    log(`[${name}] sortie code=${code}`);
    if (opts.noRespawn) return;
    setTimeout(() => keepAlive(name, cmd, args, opts), 3000);
  });
  return child;
}

// ---------------------------------------------------------------------------
// Candidats : binaire, passerelle, assets, shims, APK
// ---------------------------------------------------------------------------
const BIN_CANDIDATES = [
  path.join(ROOT, "bin", "arvys"),
  path.join(ROOT, "oc-bin", "opencode-custom"),
  path.join(ROOT, "public", "oc-bin", "opencode-custom"),
  path.join(ROOT, "oc-bin", "opencode-linux-x64", "bin", "opencode"),
];

// ---------------------------------------------------------------------------
// Agent v2 : mot de passe fixé côté spawn (OPENCODE_PASSWORD) et réinjecté
// par le proxy sur chaque requête amont (Basic opencode:<password>). Le
// navigateur ne voit jamais d'authentification — le cœur la porte pour lui.
// ---------------------------------------------------------------------------
const AGENT_PASSWORD = process.env.ARVYS_AGENT_PASSWORD || "arvys-local-agent";
const AGENT_AUTH = "Basic " + Buffer.from(`opencode:${AGENT_PASSWORD}`).toString("base64");
let AGENT_CONFIG_CONTENT = null;
try { AGENT_CONFIG_CONTENT = fs.readFileSync(path.join(ROOT, "config", "opencode.jsonc"), "utf8"); } catch (e) {}
const GW_CANDIDATES = [
  path.join(ROOT, "gateway", "arvys_zai_gateway.js"),
  path.join(ROOT, "scripts", "arvys_zai_gateway.js"),
  path.join(ROOT, "public", "arvys-gateway", "arvys_zai_gateway.js"),
  path.join(ROOT, "arvys-deploy", "gateway", "arvys_zai_gateway.js"),
];
const ASSETS_CANDIDATES = [
  path.join(ROOT, "arvys-assets"),
  path.join(ROOT, "public", "arvys-assets"),
  path.join(ROOT, "gateway", "arvys-assets"),
  path.join(ROOT, "arvys-deploy", "gateway", "arvys-assets"),
];
const ASSETS_DIR =
  ASSETS_CANDIDATES.find((p) => fs.existsSync(path.join(p, "wordmark-inline.svg")) || fs.existsSync(path.join(p, "favicon.ico"))) ||
  ASSETS_CANDIDATES[0];
const SHIMS_CANDIDATES = [
  path.join(ROOT, "shims"),
  path.join(ROOT, "arvys-assets", "shims"),
  path.join(ROOT, "gateway", "shims"),
];
const SHIMS_DIR = SHIMS_CANDIDATES.find((p) => fs.existsSync(path.join(p, "bridge.js"))) || SHIMS_CANDIDATES[0];
const APK_CANDIDATES = [
  path.join(ROOT, "apk", "arvys-code.apk"),
  path.join(ROOT, "public", "arvys-apk", "arvys-code.apk"),
];

function readShim(name) {
  try { return fs.readFileSync(path.join(SHIMS_DIR, name), "utf8"); } catch (e) { return ""; }
}
const BRIDGE_JS = readShim("bridge.js");
const VOICE_JS = readShim("voice.js");
const PTY_SHIM_JS = readShim("pty-shim.js");
const SW_STUB = readShim("sw.js");
const NUKE_JS = `(function(){try{if(window.__ocNuke)return;window.__ocNuke=1;
if(window.caches&&caches.keys){caches.keys().then(function(k){k.forEach(function(x){caches.delete(x)})}).catch(function(){})}
if(navigator.serviceWorker&&navigator.serviceWorker.getRegistrations){navigator.serviceWorker.getRegistrations().then(function(r){r.forEach(function(x){x.unregister()})}).catch(function(){})}
}catch(e){}})();`;
const DOWNLOAD_HTML = (() => {
  try { return fs.readFileSync(path.join(ASSETS_DIR, "pages", "download.html"), "utf8"); } catch (e) { return "<!DOCTYPE html><html lang=\"fr\"><head><meta charset=\"utf-8\"><title>Arvys Code</title></head><body><h1>Arvys Code</h1><p>Page d'installation indisponible.</p></body></html>"; }
})();

// Page de reset d'état navigateur (/?reset=1) : purge localStorage/sessionStorage,
// caches et service workers de CETTE origine uniquement, puis retour à l'app.
// Utile quand l'app v2 a mémorisé un état périmé (route /server/<b64> d'une
// instance morte, requêtes figées → « Chargement » infini sans modèles).
const RESET_HTML = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Arvys Code — réinitialisation</title><style>body{background:#080808;color:#dbdbdb;font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;margin:0}main{max-width:440px;padding:24px}h1{color:#fff;font-size:22px;margin:0 0 10px}</style></head><body><main><h1>Arvys Code</h1><p>Réinitialisation de l'état local…</p></main><script>
(function(){try{
  try{localStorage.clear()}catch(e){}
  try{sessionStorage.clear()}catch(e){}
  if(window.caches&&caches.keys){caches.keys().then(function(k){k.forEach(function(x){caches.delete(x)})}).catch(function(){})}
  if(navigator.serviceWorker&&navigator.serviceWorker.getRegistrations){navigator.serviceWorker.getRegistrations().then(function(r){r.forEach(function(x){x.unregister()})}).catch(function(){})}
  if(indexedDB&&indexedDB.databases){indexedDB.databases().then(function(dbs){(dbs||[]).forEach(function(d){try{indexedDB.deleteDatabase(d.name)}catch(e){}})}).catch(function(){})}
}catch(e){}
setTimeout(function(){location.replace("/")},800);
})();
</`+`script></body></html>`;

// Page d'attente (upstream pas encore prêt) : charset correct + auto-reload
const HOLD_HTML = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta http-equiv="refresh" content="5"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Arvys Code</title><style>body{background:#080808;color:#dbdbdb;font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;margin:0}main{max-width:440px;padding:24px}h1{color:#fff;font-size:22px;margin:0 0 10px}p{color:#8a8a8a;margin:6px 0}a{color:#9a9a9a}</style></head><body><main><h1>Arvys Code</h1><p>Le service démarre… ou est momentanément indisponible.</p><p>Rechargez dans quelques secondes — cette page se recharge toute seule.</p><p><a href="/download">Page d'installation</a></p></main></body></html>`;

// ---------------------------------------------------------------------------
// Pont SSE → long-polling JSON : consomme /api/event (SSE) du binaire en
// permanence et rebuffrise les événements pour /__proxy/events (le shim
// navigateur reconstruit un flux SSE synthétique côté client).
// ---------------------------------------------------------------------------
const EV_BUFFER_MAX = 500;
let evBuf = [];
let evLastSeq = 0;
const evWaiters = new Set();
let upStream = null;
let upReconnectTimer = null;

function upstreamConnect() {
  if (upStream) return;
  const up = http.request(
    { host: UPSTREAM_HOST, port: UPSTREAM_PORT, method: "GET", path: "/api/event", headers: { accept: "text/event-stream", "accept-encoding": "identity" } },
    (ur) => {
      let sbuf = "";
      ur.on("data", (c) => {
        sbuf += c.toString("utf8");
        let i;
        while ((i = sbuf.indexOf("\n")) !== -1) {
          const l = sbuf.slice(0, i).trimEnd();
          sbuf = sbuf.slice(i + 1);
          if (!l.startsWith("data:")) continue; // commentaires keepalive
          const data = l.slice(5).trimStart();
          if (!data) continue;
          try {
            const obj = JSON.parse(data);
            evLastSeq += 1;
            evBuf.push({ seq: evLastSeq, ev: obj });
            if (evBuf.length > EV_BUFFER_MAX) evBuf.splice(0, evBuf.length - EV_BUFFER_MAX);
          } catch (e) {}
        }
        if (evBuf.length) flushWaiters();
      });
      ur.on("end", scheduleReconnect);
      ur.on("error", scheduleReconnect);
    }
  );
  up.on("error", scheduleReconnect);
  up.end();
  upStream = up;
}

function scheduleReconnect() {
  upStream = null;
  if (upReconnectTimer) return;
  upReconnectTimer = setTimeout(() => {
    upReconnectTimer = null;
    upstreamConnect();
  }, 500);
}

function flushWaiters() {
  for (const w of Array.from(evWaiters)) { try { w(); } catch (e) {} }
}

function serveEvents(req, res, u) {
  const since = parseInt(u.searchParams.get("since") || "-1", 10);
  const wait = Math.min(Math.max(parseInt(u.searchParams.get("wait") || "8000", 10), 0), 15000);
  let sent = false;
  const json = (obj) => {
    if (sent) return;
    sent = true;
    const body = JSON.stringify(obj);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, must-revalidate",
      "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
  };
  const tryRespond = () => {
    if (sent) return true;
    if (since < 0) { json({ events: [], last: evLastSeq }); return true; } // init : curseur
    const out = [];
    for (let i = evBuf.length - 1; i >= 0; i--) {
      if (evBuf[i].seq > since) out.push(evBuf[i].ev);
      else break;
    }
    out.reverse();
    json({ events: out, last: evLastSeq });
    return out.length > 0;
  };
  if (tryRespond()) return;
  const timer = setTimeout(() => {
    evWaiters.delete(wake);
    tryRespond(); // timeout : rend la main avec un batch vide
  }, wait);
  const wake = () => {
    clearTimeout(timer);
    evWaiters.delete(wake);
    tryRespond();
  };
  evWaiters.add(wake);
  req.on("close", () => {
    clearTimeout(timer);
    evWaiters.delete(wake);
  });
}

// ---------------------------------------------------------------------------
// Pont PTY (terminal) : WebSocket réel vers le binaire, transporté en
// long-polling JSON pour le shim navigateur (contournement passerelle qui
// bufferise les WS). Trames : {seq, op, d(base64)} — op 1=texte, 2=binaire,
// 8=fermeture.
// ---------------------------------------------------------------------------
const ptyBridges = new Map();
let ptySeqCounter = 0;

function ptyPush(b, op, buf) {
  b.lastSeq += 1;
  b.frames.push({ seq: b.lastSeq, op, d: buf.toString("base64") });
  if (b.frames.length > 2000) b.frames.splice(0, b.frames.length - 2000);
  for (const w of Array.from(b.waiters)) { try { w(); } catch (e) {} }
}

function ptyOpen(req, res, raw) {
  let url = "";
  try {
    const j = JSON.parse(raw.toString("utf8") || "{}");
    url = String(j.url || "");
  } catch (e) {}
  let u;
  try { u = new URL(url, "http://x"); } catch (e) { u = null; }
  if (!u || u.pathname.indexOf("/api/pty/") !== 0 || u.pathname.indexOf("/connect") === -1) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ error: "URL PTY invalide" }));
    return;
  }
  const id = `ptyb_${Date.now().toString(36)}_${++ptySeqCounter}`;
  const b = { id, frames: [], lastSeq: 0, waiters: new Set(), closed: false, outbox: [], lastError: null };
  ptyBridges.set(id, b);
  const target = `ws://${UPSTREAM_HOST}:${UPSTREAM_PORT}${u.pathname}${u.search}`;
  let ws;
  try {
    ws = new WebSocket(target); // global : Node >= 22 / Bun
    if ("binaryType" in ws) ws.binaryType = "arraybuffer";
  } catch (e) {
    ptyBridges.delete(id);
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ error: "WS indisponible", detail: String(e && e.message) }));
    return;
  }
  b.ws = ws;
  ws.onopen = () => {
    log(`[ptybridge] flux ouvert ${id} → ${u.pathname}`);
    const ob = b.outbox.splice(0);
    for (const item of ob) { try { ws.send(item); } catch (e) {} }
  };
  ws.onmessage = (ev) => {
    try {
      const d = ev.data;
      if (typeof d === "string") ptyPush(b, 1, Buffer.from(d, "utf8"));
      else if (d && typeof d.arrayBuffer === "function")
        d.arrayBuffer().then((ab) => ptyPush(b, 2, Buffer.from(new Uint8Array(ab)))).catch(() => {});
      else if (d instanceof ArrayBuffer) ptyPush(b, 2, Buffer.from(new Uint8Array(d)));
      else if (ArrayBuffer.isView(d)) ptyPush(b, 2, Buffer.from(d.buffer, d.byteOffset, d.byteLength));
    } catch (e) {}
  };
  ws.onclose = () => {
    if (!b.closed) { b.closed = true; ptyPush(b, 8, Buffer.alloc(0)); }
    log(`[ptybridge] flux fermé ${id}`);
  };
  ws.onerror = (e) => {
    b.lastError = (e && e.message) || "ws error";
  };
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ id }));
}

function ptySend(req, res, id) {
  const b = ptyBridges.get(id);
  if (!b) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "flux inconnu" })); return; }
  const chunks = [];
  let size = 0;
  req.on("data", (c) => { size += c.length; if (size <= 1024 * 1024) chunks.push(c); });
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const ct = String(req.headers["content-type"] || "");
    const payload = ct.includes("octet-stream") ? new Uint8Array(body) : body.toString("utf8");
    if (b.ws && b.ws.readyState === 1) { try { b.ws.send(payload); } catch (e) {} }
    else b.outbox.push(payload);
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ ok: true }));
  });
  req.on("error", () => { try { res.destroy(); } catch (e) {} });
}

function ptyRecv(req, res, id, u) {
  const b = ptyBridges.get(id);
  if (!b) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "flux inconnu" })); return; }
  const since = parseInt(u.searchParams.get("since") || "0", 10);
  const wait = Math.min(Math.max(parseInt(u.searchParams.get("wait") || "15000", 10), 0), 20000);
  let sent = false;
  const json = (obj) => {
    if (sent) return;
    sent = true;
    const body = JSON.stringify(obj);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(body) });
    res.end(body);
  };
  const tryRespond = () => {
    if (sent) return true;
    const frames = b.frames.filter((f) => f.seq > since);
    json({ frames, last: b.lastSeq, open: !b.closed });
    return frames.length > 0;
  };
  if (tryRespond()) return;
  const timer = setTimeout(() => { b.waiters.delete(wake); tryRespond(); }, wait);
  const wake = () => { clearTimeout(timer); b.waiters.delete(wake); tryRespond(); };
  b.waiters.add(wake);
  req.on("close", () => { clearTimeout(timer); b.waiters.delete(wake); });
}

function ptyClose(req, res, id) {
  const b = ptyBridges.get(id);
  if (!b) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true })); return; }
  try { if (b.ws && b.ws.readyState <= 1) b.ws.close(); } catch (e) {}
  if (!b.closed) { b.closed = true; ptyPush(b, 8, Buffer.alloc(0)); }
  const t = setTimeout(() => ptyBridges.delete(id), 5000);
  if (t && t.unref) t.unref();
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ ok: true }));
}

// ---------------------------------------------------------------------------
// Vocal : transcription serveur (WAV base64 → texte) via le SDK z.ai
// ---------------------------------------------------------------------------
async function serveAsr(req, res) {
  const chunks = [];
  let size = 0;
  req.on("data", (c) => { size += c.length; if (size <= 24 * 1024 * 1024) chunks.push(c); });
  req.on("end", async () => {
    let audio = "";
    try {
      const j = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      audio = String(j.audio || "");
    } catch (e) {}
    if (!audio) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ error: "champ audio manquant" }));
      return;
    }
    try {
      const mod = await import("z-ai-web-dev-sdk");
      const ZAI = mod.default || mod;
      const zai = await ZAI.create();
      const r = await zai.audio.asr.create({ file_base64: audio });
      const text = (r && r.text) || "";
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ ok: true, text, transcription: text }));
    } catch (e) {
      log(`[asr] échec : ${e && e.message}`);
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ error: "transcription indisponible", detail: String((e && e.message) || e) }));
    }
  });
  req.on("error", () => { try { res.destroy(); } catch (e) {} });
}

// ---------------------------------------------------------------------------
// Rebranding — aucun « OpenCode » visible. Les occurrences minuscules
// internes (clés localStorage de thème, etc.) sont volontairement conservées
// (validé) : seul la marque affichée est remplacée.
// ---------------------------------------------------------------------------
const REBRANDS = [
  ["OpenCode Zen", "Arvys Cloud"],
  ["OPENCODE", "ARVYS"],
  ["OpenCode", "Arvys Code"],
  ["Opencode", "Arvys Code"],
];

// Logos : les gabarits SVG « opencode » du bundle UI (wordmark héros, marque,
// splash) sont remplacés par les marques ARVYS, à l'octet près. Chaînes
// générées par scripts/build_logo_swaps.py (voir arvys-brand-logos.js).
let LOGO_SWAPS = null;
try { LOGO_SWAPS = require("./arvys-brand-logos"); } catch (e) {}
const LOGO_NEEDLES = [
  ["wordmark", 'viewBox="0 0 234 42"'],
  ["mark", "data-component=logo-mark"],
  ["splash", "data-component=logo-splash"],
  // Héros de l'écran « Nouvelle session » : gabarit 720×129 dans le chunk
  // paresseux new-session-*.js (généré par scripts/build_hero_swap.py).
  ["hero", 'viewBox="0 0 720 129"'],
];

function rebrand(text, ct) {
  let out = text;
  if (LOGO_SWAPS) {
    for (const [key, needle] of LOGO_NEEDLES) {
      if (out.includes(needle)) {
        const find = LOGO_SWAPS.find[key];
        const repl = LOGO_SWAPS.repl[key];
        if (find && repl && out.includes(find)) out = out.split(find).join(repl);
      }
    }
  }
  // v2 : les bundles ESM contiennent des identifiants nus (ex. installOpencode:{input:iI})
  // et des clés i18n composées (ex. "onboarding.updateOpencode") — un remplacement
  // aveugle y produit un identifiant avec espace (SyntaxError) : le module ne parse
  // plus, l'app ne monte plus, la page reste noire (fond #080808/#fafafa seul rendu).
  // En JS on ne remplace donc qu'aux frontières d'identifiants ASCII ; « $ » et « . »
  // sont inclus du côté gauche : les vraies variables d'env affichées ($OPENCODE_*)
  // et les accès propriété restent exacts. \w étant ASCII en JS, les chaînes visibles
  // collées à des CJK (OpenCode是…) sont bien couvertes. Validé : node --check sur les
  // 51 chunks v2 rebrandés = 0 erreur (scripts/scan_v2_rebrand_risk.py).
  const isJs = ct.includes("javascript") || ct.includes("ecmascript");
  if (isJs) {
    if (/OpenCode Zen|OPENCODE|OpenCode|Opencode/.test(out)) {
      out = out.replace(/(?<![\w$.])OpenCode Zen(?![\w$])/g, "Arvys Cloud");
      out = out.replace(/(?<![\w$.])OPENCODE(?![\w$])/g, "ARVYS");
      out = out.replace(/(?<![\w$.])OpenCode(?![\w$])/g, "Arvys Code");
      out = out.replace(/(?<![\w$.])Opencode(?![\w$])/g, "Arvys Code");
    }
    return out;
  }
  for (const [a, b] of REBRANDS) if (out.includes(a)) out = out.split(a).join(b);
  return out;
}

const NUKE_TAG = `<script src="${NUKE_PATH}"></script>`;

// ---------------------------------------------------------------------------
// Assets ARVYS + APK
// ---------------------------------------------------------------------------
const ARVYS_ICON_ROUTES = {
  "/favicon.ico": "favicon.ico",
  "/apple-touch-icon.png": "apple-touch-icon.png",
  "/manifest.json": "manifest.json",
  "/icon-192.png": "icon-192.png",
  "/icon-512.png": "icon-512.png",
  "/icon.svg": "icon.svg",
  "/wordmark-inline.svg": "wordmark-inline.svg",
  "/mark-inline.svg": "mark-inline.svg",
  "/wordmark.svg": "wordmark.svg",
};

function contentTypeOf(name) {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".ico") return "image/x-icon";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".apk") return "application/vnd.android.package-archive";
  return "application/octet-stream";
}

function serveArvysAsset(res, name) {
  const file = path.join(ASSETS_DIR, path.basename(name));
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("introuvable");
    return;
  }
  res.writeHead(200, {
    "Content-Type": contentTypeOf(name),
    "Cache-Control": "no-store, must-revalidate",
    "Content-Length": buf.length,
  });
  res.end(buf);
}

function serveApk(res) {
  const apk = APK_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
  if (!apk) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("APK indisponible");
    return;
  }
  const st = fs.statSync(apk);
  res.writeHead(200, {
    "Content-Type": "application/vnd.android.package-archive",
    "Content-Length": st.size,
    "Content-Disposition": 'attachment; filename="arvys-code.apk"',
    "Cache-Control": "no-store, must-revalidate",
  });
  fs.createReadStream(apk).pipe(res);
}

// ---------------------------------------------------------------------------
// Serveur principal
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  // 1) Cache-buster sur la racine : chaque ouverture de l'app reçoit une URL unique
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/" && !u.search) {
    res.writeHead(302, {
      Location: `/?v=${Date.now()}`,
      "Cache-Control": "no-store, must-revalidate",
    });
    res.end();
    return;
  }

  // Diagnostics internes (aucun secret : existence de fichiers, ports, journaux)
  if (u.pathname === "/__status") {
    const stat = (p) => {
      try {
        const st = fs.statSync(p);
        return { exists: true, size: st.size, exec: !!(st.mode & 0o111) };
      } catch (e) {
        return { exists: false };
      }
    };
    const ocFound = BIN_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
    const body = {
      service: "Arvys Code",
      uptime_s: Math.round(process.uptime()),
      node: process.version,
      cwd: process.cwd(),
      root: ROOT,
      listen: LISTEN_PORT,
      upstream: { port: UPSTREAM_PORT },
      gateway: { port: GATEWAY_PORT },
      binaries: BIN_CANDIDATES.map((p) => ({ path: p, ...stat(p) })),
      gateway_scripts: GW_CANDIDATES.map((p) => ({ path: p, ...stat(p) })),
      binary: ocFound || null,
      apk: stat(APK_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } }) || APK_CANDIDATES[0]),
      assets: {
        favicon: stat(path.join(ASSETS_DIR, "favicon.ico")),
        icon512: stat(path.join(ASSETS_DIR, "icon-512.png")),
        shims: stat(path.join(SHIMS_DIR, "bridge.js")),
      },
      build_id: (() => { try { return fs.readFileSync(path.join(ROOT, ".next", "BUILD_ID"), "utf8").trim(); } catch (e) { return null; } })(),
      spawn: SPAWN_STATS,
      env: {
        port: process.env.PORT || null,
        oc_port: process.env.OC_PORT || null,
        gateway_port: process.env.GATEWAY_PORT || null,
        core_port: process.env.PROXY_CORE_PORT || null,
      },
      pty_open: ptyBridges.size,
      log: LOG_RING.slice(-60),
    };
    Promise.all([
      portBusy(UPSTREAM_PORT),
      portBusy(GATEWAY_PORT),
      fetch(`http://127.0.0.1:${GATEWAY_PORT}/health`).then((r) => r.json()).catch(() => null),
    ]).then(([upBusy, gwBusy, gwHealth]) => {
      body.upstream.reachable = upBusy;
      body.gateway.reachable = gwBusy;
      body.gateway.health = gwHealth;
      body.ok = upBusy;
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(body, null, 2));
    });
    return;
  }

  // Script de purge servi par le proxy même (CSP 'self' l'autorise)
  if (u.pathname === NUKE_PATH) {
    res.writeHead(200, {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store, must-revalidate",
    });
    res.end(NUKE_JS);
    return;
  }

  // STUB service worker : désamorce le precache Workbox et se désenregistre.
  if (u.pathname === "/sw.js") {
    res.writeHead(200, {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store, must-revalidate",
    });
    res.end(SW_STUB);
    return;
  }

  // Shims navigateur (ponts SSE / vocal / terminal)
  if (u.pathname === BRIDGE_PATH) {
    res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store, must-revalidate" });
    res.end(BRIDGE_JS);
    return;
  }
  if (u.pathname === EVENTS_PATH) { serveEvents(req, res, u); return; }
  if (u.pathname === VOICE_PATH) {
    res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store, must-revalidate" });
    res.end(VOICE_JS);
    return;
  }
  if (u.pathname === PTY_SHIM_PATH) {
    res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store, must-revalidate" });
    res.end(PTY_SHIM_JS);
    return;
  }

  // Pont PTY : open / send / recv / close
  if (u.pathname === PTY_BRIDGE + "/open" && req.method === "POST") {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => { size += c.length; if (size < 64 * 1024) chunks.push(c); });
    req.on("end", () => ptyOpen(req, res, Buffer.concat(chunks)));
    req.on("error", () => { try { res.destroy(); } catch (e) {} });
    return;
  }
  {
    const m = u.pathname.match(/^\/__ptybridge\/([A-Za-z0-9_]+)\/(send|recv|close)$/);
    if (m) {
      const [, id, action] = m;
      if (action === "send" && req.method === "POST") return ptySend(req, res, id);
      if (action === "recv" && req.method === "GET") return ptyRecv(req, res, id, u);
      if (action === "close" && req.method === "POST") return ptyClose(req, res, id);
    }
  }

  // Transcription serveur du mode vocal (audio WAV base64 → texte)
  if (u.pathname === ASR_PATH) {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "POST requis" }));
      return;
    }
    serveAsr(req, res);
    return;
  }

  // Assets ARVYS CODE (icônes, manifest) + interception des icônes OpenCode
  if (ARVYS_ICON_ROUTES[u.pathname]) { serveArvysAsset(res, ARVYS_ICON_ROUTES[u.pathname]); return; }
  if (u.pathname.startsWith("/arvys-icons/") && !u.pathname.includes("..")) {
    serveArvysAsset(res, u.pathname.slice("/arvys-icons/".length));
    return;
  }

  // Réinitialisation d'état navigateur : /?reset=1 (purge locale + retour à l'app)
  if (u.pathname === "/" && u.searchParams.has("reset")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store, must-revalidate" });
    res.end(RESET_HTML);
    return;
  }

  // Page de téléchargement (app mobile / PWA / navigateur)
  if (u.pathname === "/download" || u.pathname === "/download/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(DOWNLOAD_HTML);
    return;
  }

  // APK Capacitor
  if (u.pathname === "/apk/arvys-code.apk" || u.pathname.startsWith("/apk/")) {
    if (u.pathname.endsWith(".apk")) { serveApk(res); return; }
  }

  // ------------------------------------------------------------------
  // Proxy vers le binaire (l'app) — rebranding + injection des shims
  // ------------------------------------------------------------------
  const headers = { ...req.headers, host: `${UPSTREAM_HOST}:${UPSTREAM_PORT}` };
  if (!headers.authorization) headers.authorization = AGENT_AUTH; // v2 : API protégée par mot de passe
  // corps décodés en utf8 pour le rebranding : jamais de gzip upstream
  delete headers["accept-encoding"];
  headers["accept-encoding"] = "identity";
  const up = http.request(
    {
      host: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      method: req.method,
      path: req.url,
      headers,
    },
    (ur) => {
      const ct = String(ur.headers["content-type"] || "");
      const outHeaders = { ...ur.headers };
      const isHtml = ct.includes("text/html");
      const isJsCss = ct.includes("javascript") || ct.includes("text/css");
      // JSON : noms de fournisseurs affichés dans l'UI (ex. /api/provider)
      const isJson = ct.includes("application/json") || ct.includes("text/json");

      if (isHtml || isJsCss || isJson) {
        // Corps bufferisé : injection shims (HTML) + rebranding + framing strict
        const chunks = [];
        let size = 0;
        ur.on("data", (c) => {
          size += c.length;
          if (size > 12 * 1024 * 1024) { ur.destroy(); return; }
          chunks.push(c);
        });
        ur.on("end", () => {
          let body = Buffer.concat(chunks).toString("utf8");
          if (isHtml) {
            // v2 : l'app native gère elle-même PTY/SSE/API — plus de shims v1 injectés.
            outHeaders["permissions-policy"] = "microphone=*, camera=(), geolocation=()";
          }
          body = rebrand(body, ct);
          // Framing strict : suppression de TOUT en-tête hop-by-hop relayé —
          // rejoués tels quels ils produisent une réponse HTTP invalide quand
          // le cœur tourne sous Bun (fetch du miroir → InvalidHTTPResponse).
          // Content-Length exact sur le corps final = réponse non-chunked.
          delete outHeaders["content-length"];
          delete outHeaders["content-encoding"];
          delete outHeaders["etag"];
          delete outHeaders["transfer-encoding"];
          delete outHeaders["connection"];
          delete outHeaders["keep-alive"];
          const out = Buffer.from(body, "utf8");
          outHeaders["content-length"] = out.length;
          outHeaders["cache-control"] = "no-store, must-revalidate";
          res.writeHead(ur.statusCode || 200, outHeaders);
          res.end(out);
        });
        ur.on("error", () => { try { res.destroy(); } catch (e) {} });
      } else {
        // Streaming transparent (API, SSE, assets) — même hygiène hop-by-hop ;
        // le serveur recadre lui-même le transfert (chunked ou longueur connue).
        delete outHeaders["transfer-encoding"];
        delete outHeaders["connection"];
        delete outHeaders["keep-alive"];
        res.writeHead(ur.statusCode || 200, outHeaders);
        ur.pipe(res);
        ur.on("error", () => { try { res.destroy(); } catch (e) {} });
      }
    }
  );

  up.on("error", (err) => {
    log(`upstream error ${req.method} ${req.url}: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(HOLD_HTML);
    } else {
      try { res.destroy(); } catch (e) {}
    }
  });

  req.pipe(up);
  req.on("error", () => up.destroy());
});

// Websockets (tunnel transparent + réponse d'erreur relayée au lieu de pendre)
server.on("upgrade", (req, socket, head) => {
  const up = http.request({
    host: UPSTREAM_HOST,
    port: UPSTREAM_PORT,
    method: req.method,
    path: req.url,
    headers: { ...req.headers, host: `${UPSTREAM_HOST}:${UPSTREAM_PORT}`, ...(req.headers.authorization ? {} : { authorization: AGENT_AUTH }) },
  });
  up.on("upgrade", (ur, usocket, uhead) => {
    const lines = [`HTTP/1.1 101 Switching Protocols`];
    for (const [k, v] of Object.entries(ur.headers)) lines.push(`${k}: ${v}`);
    socket.write(lines.join("\r\n") + "\r\n\r\n");
    usocket.pipe(socket);
    socket.pipe(usocket);
    if (uhead.length) socket.write(uhead);
  });
  up.on("response", (ur) => {
    const lines = [`HTTP/1.1 ${ur.statusCode} ${ur.statusMessage || ""}`.trimEnd()];
    for (const [k, v] of Object.entries(ur.headers)) lines.push(`${k}: ${v}`);
    try { socket.write(lines.join("\r\n") + "\r\n\r\n"); } catch (e) {}
    ur.pipe(socket);
    socket.on("error", () => { try { ur.destroy(); } catch (e) {} });
  });
  up.on("error", () => socket.destroy());
  up.end();
  if (head.length) up.write(head);
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`[core] :${LISTEN_PORT} déjà occupé — une instance tourne déjà, sortie silencieuse`);
    process.exit(0);
  }
  console.error(`[core] erreur serveur: ${err && err.message}`);
});

server.listen(LISTEN_PORT, "0.0.0.0", () => {
  log(`ARVYS CORE prêt sur 0.0.0.0:${LISTEN_PORT} -> ARVYS ${UPSTREAM_HOST}:${UPSTREAM_PORT} | passerelle :${GATEWAY_PORT} | assets ${ASSETS_DIR}`);
  // Spawns supervisés (mode preview : pas de spawn si port déjà occupé)
  const bin = BIN_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
  if (!bin) {
    log(`[arvys] binaire introuvable — candidats : ${BIN_CANDIDATES.join(" | ")}`);
  } else {
    portBusy(UPSTREAM_PORT).then((busy) => {
      if (busy) log(`[arvys] :${UPSTREAM_PORT} déjà occupé — pas de spawn (mode preview)`);
      else keepAlive("arvys", bin, ["serve", "--hostname", "127.0.0.1", "--port", String(UPSTREAM_PORT)], {
        cwd: ROOT, // projet par défaut = racine du workspace (pas le dossier du binaire)
        env: {
          OPENCODE_PASSWORD: AGENT_PASSWORD,
          ...(AGENT_CONFIG_CONTENT ? { OPENCODE_CONFIG_CONTENT: AGENT_CONFIG_CONTENT } : {}),
        },
      });
    });
  }
  const gw = GW_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
  if (!gw) {
    log(`[gateway] script introuvable — candidats : ${GW_CANDIDATES.join(" | ")}`);
  } else {
    portBusy(GATEWAY_PORT).then((busy) => {
      if (busy) log(`[gateway] :${GATEWAY_PORT} déjà occupé — pas de spawn (mode preview)`);
      else keepAlive("gateway", process.execPath, [gw], { cwd: ROOT });
    });
  }
  upstreamConnect(); // connexion SSE persistante pour le bridge long-polling
});

