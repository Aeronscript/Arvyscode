#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ajoute le swap « hero » (wordmark 720×129 de l'écran Nouvelle session) à
arvys-brand-logos.js.

Le gabarit héros vit dans le chunk paresseux new-session-*.js (PAS dans le
bundle principal) : c'est pourquoi le rebranding initial (wordmark 234×42,
mark, splash) laissait le héros afficher « opencode ».

Usage : python3 scripts/build_hero_swap.py [chunk]  (défaut /tmp/newsession.js)
"""
import json
import re
import sys

CHUNK = sys.argv[1] if len(sys.argv) > 1 else "/tmp/newsession.js"
ASSETS = "/home/z/my-project/arvys-assets"
OUT = "/home/z/my-project/arvys-brand-logos.js"

chunk = open(CHUNK, encoding="utf-8", errors="replace").read()

# --- Gabarit héros : extraction byte-exact -----------------------------------
# Le gabarit Solid f('...') ne contient PAS de </svg> : la chaîne se termine
# dans les <stop> du dégradé (la fermeture est faite par le runtime). On
# extrait donc la chaîne JS complète : de <svg… jusqu'à l'apostrophe fermante
# non échappée.
i = chunk.find('<svg xmlns=http://www.w3.org/2000/svg viewBox="0 0 720 129"')
if i < 0:
    raise SystemExit("gabarit héros introuvable dans le chunk")
j = i
while True:
    j = chunk.find("'", j + 1)
    if j < 0:
        raise SystemExit("fin de chaîne introuvable")
    bs, k = 0, j - 1
    while k >= i and chunk[k] == "\\":
        bs += 1
        k -= 1
    if bs % 2 == 0:
        break
find_hero = chunk[i:j]
n = chunk.count(find_hero)
if n != 1:
    raise SystemExit("gabarit héros : %d occurrences (attendu 1)" % n)

# --- Remplacement ARVYS : marque officielle mise à l'échelle ------------------
# On garde TOUT le squelette (opacités, dégradé, stops) et on remplace
# UNIQUEMENT le bloc des 8 lettres par la marque ARVYS sur sa grille.
ls = find_hero.find("<path opacity=0.7")
le = find_hero.rfind("</path>") + len("</path>")
if ls < 0 or le <= ls:
    raise SystemExit("bloc des lettres introuvable dans le gabarit héros")
prefix, suffix = find_hero[:ls], find_hero[le:]

wm = open(ASSETS + "/wordmark-inline.svg", encoding="utf-8").read().strip()
a = wm.find(">")
b = wm.rfind("</svg>")
inner = wm[a + 1 : b]

# Géométrie : lettres héros = y 18 → 110.143 (h = 92.143) dans un viewBox
# 720×129. Marque ARVYS = lettres y 6 → 36 (h = 30) dans un viewBox 210×42.
# Échelle = 92.143/30 ≈ 3.0714 → largeur 645 ; centrage x = (720-645)/2 = 37.5.
S = 92.143 / 30.0
TX = round((720 - 210 * S) / 2, 3)
TY = round(18 - 6 * S, 3)

repl_hero = (
    prefix
    + '<g transform="translate(%s %s) scale(%s)">' % (TX, TY, round(S, 5))
    + inner
    + "</g>"
    + suffix
)

for name, s in (("hero", find_hero), ("repl hero", repl_hero)):
    if "'" in s or "\\" in s:
        raise SystemExit("%s : caractère ' ou \\ interdit" % name)

# --- Fusion dans arvys-brand-logos.js ----------------------------------------
old = open(OUT, encoding="utf-8").read()
start = old.index("{")
end = old.rindex("}")
mod = json.loads(old[start : end + 1])

mod["find"]["hero"] = find_hero
mod["repl"]["hero"] = repl_hero

module = (
    '"use strict";\n'
    "// Généré par scripts/build_logo_swaps.py + scripts/build_hero_swap.py.\n"
    "// Chaînes EXACTES des gabarits SVG « opencode » du bundle UI (index-*.js\n"
    "// et chunk new-session-*.js) + remplacements ARVYS (assets officiels).\n"
    "// Si le binaire est mis à jour et que les gabarits changent, relancer :\n"
    "//   curl les bundles puis python3 scripts/build_logo_swaps.py <bundle>\n"
    "//   puis python3 scripts/build_hero_swap.py <chunk-new-session>\n"
    "module.exports = " + json.dumps(mod, ensure_ascii=False, indent=2) + ";\n"
)

with open(OUT, "w", encoding="utf-8") as f:
    f.write(module)

print("OK →", OUT)
print("  find hero :", len(find_hero), "chars")
print("  repl hero :", len(repl_hero), "chars")
print("  transform : translate(%s %s) scale(%s)" % (TX, TY, round(S, 5)))
