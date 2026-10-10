#!/usr/bin/env node
/**
 * ARVYS CODE — persistance par instantanés Git (Render gratuit)
 *
 * Problème : le disque d'un service Render gratuit est éphémère — chaque mise
 * en veille ou redéploiement efface discussions, projets et configuration.
 * Solution : le cœur exporte régulièrement un instantané des données vers un
 * dépôt GitHub PRIVÉ (un seul commit amendé + force-push — taille stable),
 * et le restaure au démarrage AVANT de lancer l'agent.
 *
 * Couvert :
 *  - ~/.local/share/opencode  → sessions, messages (historique des discussions)
 *  - ~/.config/opencode       → auth.json, opencode.json, thèmes
 *  - <workspace>              → projets importés / créés par l'utilisateur
 *  - ARVYS_SNAP_DIRS="cle:/chemin,cle2:/chemin2" → dossiers additionnels
 *
 * Activation (≈ 3 minutes) :
 *  1) créer un dépôt GitHub PRIVÉ vide (ex. Aeronscript/arvys-data)
 *  2) fine-grained token avec Contents: Read/Write limité à CE dépôt
 *  3) sur Render : ARVYS_SNAP_REPO="owner/repo" + ARVYS_SNAP_TOKEN="github_pat_…"
 * Sans ces variables, le module est inerte — zéro effet de bord.
 *
 * Sécurité : le token vit uniquement dans l'environnement d'exécution
 * (variables Render). Il n'apparaît dans aucun fichier versionné.
 * Si la restauration échoue au démarrage, les snapshots sont désactivés pour
 * la session (on n'écrase JAMAIS le dépôt distant avec un état incertain).
 */
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

const REPO = (process.env.ARVYS_SNAP_REPO || "").trim();
const TOKEN = (process.env.ARVYS_SNAP_TOKEN || "").trim();
const INTERVAL_MS = Math.max(60, parseInt(process.env.ARVYS_SNAP_INTERVAL_S || "180", 10) || 180) * 1000;
const REMOTE_URL = (
  process.env.ARVYS_SNAP_URL ||
  (REPO && TOKEN ? `https://x-access-token:${TOKEN}@github.com/${REPO}.git` : "")
).trim();
const TMP = "/tmp/arvys-snap";
const REPO_DIR = path.join(TMP, "repo");
const GIT_IDENT = ["-c", "user.name=Arvys Snapshots", "-c", "user.email=snap@arvyscode.local"];
const BIG_FILE = 25 * 1024 * 1024; // au-delà : ignoré (git refuse > 100 Mo)

const SKIP_DIRS = new Set([
  "node_modules", ".git", "__pycache__", ".venv", "venv", ".cache", ".next",
  "dist", "build", ".turbo", ".npm", ".pnpm-store", "coverage", ".gradle",
]);

const enabled = !!REMOTE_URL;
const STATS = {
  enabled,
  repo: REPO || null,
  lastSnapshot: null,
  lastRestore: null,
  lastError: null,
  snapshots: 0,
  snapDisabled: false,
};
const CTX = { workspace: null, dirs: [] };

let busy = false;
let restoreSettled = !enabled; // aucun snapshot tant que la restauration n'a pas tranché
let timer = null;

function log(msg) {
  console.log(`[persist] ${msg}`);
}

function execFileP(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 30000, ...opts }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr: String(stderr || "") }));
      else resolve(String(stdout || ""));
    });
  });
}

function git(args, opts = {}) {
  return execFileP("git", ["-C", REPO_DIR, ...GIT_IDENT, ...args], { timeout: 25000, ...opts });
}

function listTargets() {
  const home = os.homedir();
  const xdgData = process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
  const xdgCfg = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  const list = [
    { key: "oc-data", src: path.join(xdgData, "opencode") },
    { key: "oc-config", src: path.join(xdgCfg, "opencode") },
  ];
  if (CTX.workspace) list.push({ key: "workspace", src: CTX.workspace });
  for (const d of CTX.dirs || []) list.push(d);
  const seen = new Set();
  return list.filter((t) => t && t.key && t.src && !seen.has(t.key) && seen.add(t.key));
}

// Copie récursive filtrée : exclut les dossiers techniques, les liens qui
// sortent de l'arbre source et les fichiers trop lourds.
function copyTree(src, dst) {
  fs.cpSync(src, dst, {
    recursive: true,
    force: true,
    dereference: false,
    filter: (s) => {
      try {
        const rel = path.relative(src, s);
        if (!rel) return true;
        if (SKIP_DIRS.has(path.basename(s))) return false;
        const st = fs.lstatSync(s);
        if (st.isSymbolicLink()) {
          const target = path.resolve(path.dirname(s), fs.readlinkSync(s));
          if (target !== src && !target.startsWith(src + path.sep)) return false;
        }
        if (st.isFile() && st.size > BIG_FILE) {
          log(`fichier trop lourd ignoré : ${rel}`);
          return false;
        }
        return true;
      } catch (e) {
        return false;
      }
    },
  });
}

async function ensureRepo() {
  try {
    if (fs.statSync(path.join(REPO_DIR, ".git")).isDirectory()) return;
  } catch (e) {}
  fs.rmSync(REPO_DIR, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  await execFileP("git", ["clone", "--depth", "1", REMOTE_URL, REPO_DIR], { timeout: 45000 });
  fs.writeFileSync(path.join(REPO_DIR, ".gitignore"), "# instantanés Arvys Code\n*.tmp\n*.lock\n");
}

// Restaure le dernier instantané dans les emplacements réels (fusion, sans
// suppression). Cible = chemin découvert à l'exécution, sinon chemin d'origine
// enregistré dans meta.json.
async function restore() {
  if (!enabled) return false;
  const t0 = Date.now();
  const RST = path.join(TMP, "restore");
  try {
    fs.rmSync(RST, { recursive: true, force: true });
    await execFileP("git", ["clone", "--depth", "1", REMOTE_URL, RST], { timeout: 45000 });
    const map = {};
    for (const t of listTargets()) map[t.key] = t.src;
    let meta = null;
    try { meta = JSON.parse(fs.readFileSync(path.join(RST, "meta.json"), "utf8")); } catch (e) {}
    if (meta && meta.targets) {
      for (const [k, v] of Object.entries(meta.targets)) if (!map[k]) map[k] = v;
    }
    const dataDir = path.join(RST, "data");
    let restored = 0;
    if (fs.existsSync(dataDir)) {
      for (const key of fs.readdirSync(dataDir)) {
        const dst = map[key];
        if (!dst) { log(`restore : cible inconnue « ${key} » — ignoré`); continue; }
        const src = path.join(dataDir, key);
        fs.mkdirSync(dst, { recursive: true });
        fs.cpSync(src, dst, { recursive: true, force: true, dereference: false });
        restored += 1;
      }
    }
    STATS.lastRestore = new Date().toISOString();
    log(`restauration OK : ${restored} emplacement(s) en ${Date.now() - t0} ms`);
    return restored > 0;
  } catch (e) {
    STATS.lastError = String((e && e.message) || e);
    STATS.snapDisabled = true;
    log(`restauration impossible (${STATS.lastError}) — snapshots désactivés pour cette session`);
    return false;
  } finally {
    restoreSettled = true;
  }
}

// Instantané : copie filtrée → commit (amendé : historique = 1 commit) → push.
async function snapshot(reason) {
  if (!enabled || busy || STATS.snapDisabled || !restoreSettled) return false;
  busy = true;
  try {
    await ensureRepo();
    fs.rmSync(path.join(REPO_DIR, "data"), { recursive: true, force: true });
    const meta = { version: 2, time: new Date().toISOString(), reason: reason || "auto", targets: {} };
    for (const t of listTargets()) {
      if (!fs.existsSync(t.src)) continue;
      const dst = path.join(REPO_DIR, "data", t.key);
      fs.mkdirSync(dst, { recursive: true });
      copyTree(t.src, dst);
      meta.targets[t.key] = t.src;
    }
    fs.writeFileSync(path.join(REPO_DIR, "meta.json"), JSON.stringify(meta, null, 2));
    await git(["add", "-A"]);
    if (!(await git(["status", "--porcelain"])).trim()) {
      STATS.lastSnapshot = meta.time; // rien de nouveau depuis le dernier push
      return true;
    }
    const msg = `snapshot ${meta.time} (${meta.reason})`;
    let hasHead = true;
    try { await git(["rev-parse", "--verify", "HEAD"]); } catch (e) { hasHead = false; }
    await git(hasHead ? ["commit", "--amend", "-m", msg] : ["commit", "-m", msg]);
    await execFileP("git", ["-C", REPO_DIR, "push", "--force", REMOTE_URL, "HEAD"], { timeout: 45000 });
    STATS.lastSnapshot = meta.time;
    STATS.snapshots += 1;
    STATS.lastError = null;
    log(`instantané poussé (${meta.reason})`);
    return true;
  } catch (e) {
    STATS.lastError = String((e && e.message) || e);
    log(`instantané échoué : ${STATS.lastError}`);
    return false;
  } finally {
    busy = false;
  }
}

// Appelé avant le spawn des services : attend la fin de la restauration,
// plafonné à capMs (défaut 15 s) pour ne jamais retarder le démarrage.
function whenReady(cb, capMs) {
  if (!enabled || restoreSettled) { cb(false); return; }
  let done = false;
  const t = setTimeout(() => {
    if (!done) {
      done = true;
      log("délai de restauration dépassé — démarrage sans attendre");
      cb(false);
    }
  }, capMs || 15000);
  const check = setInterval(() => {
    if (restoreSettled && !done) {
      done = true;
      clearInterval(check);
      clearTimeout(t);
      cb(true);
    }
  }, 100);
}

// Flush d'arrêt (SIGTERM envoyé par Render à chaque mise en veille/déploiement).
function flushOnShutdown() {
  if (!enabled) return;
  log("arrêt détecté : instantané final…");
  snapshot("shutdown").catch(() => {});
  // Filet de sécurité : Render laisse ~30 s avant SIGKILL ; on force la sortie.
  setTimeout(() => process.exit(0), 9000).unref();
}

function init(opts = {}) {
  CTX.workspace = opts.workspace || CTX.workspace || null;
  CTX.dirs = Array.isArray(opts.dirs) ? opts.dirs.slice() : [];
  for (const part of String(process.env.ARVYS_SNAP_DIRS || "").split(",")) {
    const i = part.indexOf(":");
    if (i > 0) {
      const key = part.slice(0, i).trim().replace(/[^a-zA-Z0-9_-]/g, "_");
      const src = part.slice(i + 1).trim();
      if (key && src) CTX.dirs.push({ key, src });
    }
  }
  if (!enabled) {
    log("désactivé (ARVYS_SNAP_REPO / ARVYS_SNAP_TOKEN absents)");
    restoreSettled = true;
    return;
  }
  log(`actif → ${REPO} (intervalle ${Math.round(INTERVAL_MS / 1000)} s)`);
  restoreSettled = false;
  restore();
  timer = setInterval(() => { snapshot("interval"); }, INTERVAL_MS);
  timer.unref();
  process.once("SIGTERM", flushOnShutdown);
  process.once("SIGINT", flushOnShutdown);
}

function status() {
  return { ...STATS, interval_s: Math.round(INTERVAL_MS / 1000), workspace: CTX.workspace };
}

module.exports = { init, status, snapshot, restore, whenReady, flushOnShutdown };
