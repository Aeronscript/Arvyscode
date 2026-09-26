"use strict";
/**
 * Pré-rebranding statique de l'UI miroitée → arvys-cloud/ui/
 * Applique UNE FOIS, hors ligne :
 *   1. les remplacements de logos (arvys-brand-logos.js — mêmes chaînes que le runtime) ;
 *   2. les rebrands textuels (OpenCode→Arvys Code…) ;
 *   3. les icônes/manifest Arvys aux chemins référencés par l'UI.
 * Vérifie ensuite l'absence totale des marques d'origine.
 */
const fs = require("fs");
const path = require("path");

const ROOT = "/home/z/my-project";
const SRC = path.join(ROOT, "arvys-cloud", "ui-src");
const DST = path.join(ROOT, "arvys-cloud", "ui");
const ASSETS = path.join(ROOT, "arvys-assets");
const LOGOS = require(path.join(ROOT, "arvys-brand-logos.js"));

const REBRANDS = [
  ["OpenCode Zen", "Arvys Cloud"],
  ["OPENCODE", "ARVYS"],
  ["OpenCode", "Arvys Code"],
  ["Opencode", "Arvys Code"],
];

function prebrand(text) {
  let out = text;
  for (const k of ["wordmark", "mark", "splash"]) {
    if (out.includes(LOGOS.find[k])) out = out.split(LOGOS.find[k]).join(LOGOS.repl[k]);
  }
  for (const [a, b] of REBRANDS) if (out.includes(a)) out = out.split(a).join(b);
  return out;
}

function walk(dir, cb) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, cb);
    else cb(p);
  }
}

// 1) copie propre
fs.rmSync(DST, { recursive: true, force: true });
fs.cpSync(SRC, DST, { recursive: true });

// 2) pré-rebranding des fichiers texte
let touched = 0;
walk(DST, (p) => {
  if (!/\.(html|js|css)$/.test(p)) return;
  const before = fs.readFileSync(p, "utf8");
  const after = prebrand(before);
  if (after !== before) {
    fs.writeFileSync(p, after);
    touched++;
  }
});

// 3) icônes + manifest Arvys aux chemins référencés par l'UI
const ICON_MAP = {
  "favicon-v3.ico": "favicon.ico",
  "favicon-v3.svg": "icon.svg",
  "favicon-96x96-v3.png": "icon-192.png",
  "apple-touch-icon-v3.png": "apple-touch-icon.png",
  "site.webmanifest": "manifest.json",
  "social-share.png": "icon-512.png",
};
for (const [dst, src] of Object.entries(ICON_MAP)) {
  const from = path.join(ASSETS, src);
  const to = path.join(DST, dst);
  if (fs.existsSync(from)) {
    fs.copyFileSync(from, to);
    console.log(`  icône  ${dst.padEnd(28)} ← ${src}`);
  } else {
    console.log(`  !! asset manquant : ${src}`);
  }
}

// 4) vérifications
const bundle = path.join(DST, "assets", "index-gyzZF0EC.js");
const idx = path.join(DST, "index.html");
let ok = true;
function check(name, cond) {
  console.log(`  ${cond ? "✓" : "✗ ÉCHEC"} ${name}`);
  if (!cond) ok = false;
}
if (fs.existsSync(bundle)) {
  const b = fs.readFileSync(bundle, "utf8");
  check("bundle : ancien wordmark opencode supprimé", !b.includes("M18 30H6V18H18V30Z"));
  check("bundle : wordmark ARVYS présent", b.includes("translate(12 6)"));
  check("bundle : ancienne marque logo-mark supprimée", !b.includes("M12 4H4V16H12V4ZM16 20H0V0H16V20Z"));
  check("bundle : marque ARVYS présente", b.includes("logo-logo-mark-a"));
  check("bundle : aucun « OpenCode » visible", !/OpenCode|OPENCODE/.test(b));
}
if (fs.existsSync(idx)) {
  const h = fs.readFileSync(idx, "utf8");
  check("index : aucun « OpenCode » visible", !/OpenCode|OPENCODE/.test(h));
  check("index : shims pont présents", h.includes("/__ptybridge/shim.js") && h.includes("/__proxy/bridge.js"));
}

let files = 0, bytes = 0;
walk(DST, (p) => { files++; bytes += fs.statSync(p).size; });
console.log(`PRÉ-REBRANDING TERMINÉ : ${touched} fichiers transformés, ${files} fichiers, ${(bytes / 1048576).toFixed(2)} Mo — ${ok ? "TOUT OK" : "ÉCHECS À CORRIGER"}`);
process.exit(ok ? 0 : 1);
