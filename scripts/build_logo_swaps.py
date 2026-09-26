#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Génère arvys-brand-logos.js : chaînes EXACTES des gabarits SVG « opencode »
présents dans le bundle de l'interface (index-*.js) + remplacements ARVYS.

Sources :
  - bundle UI         : /tmp/ui-bundle.js (récupéré via curl sur le cœur local)
  - wordmark-inline.svg / mark-inline.svg : assets ARVYS (marques officielles)

Les gabarits Solid.js du bundle sont des chaînes P('...') ; on les remplace
à l'octet près dans rebrand() de proxy-core.js. Le script vérifie que chaque
chaîne « find » existe exactement UNE fois dans le bundle courant.

Usage : python3 scripts/build_logo_swaps.py [bundle]  (défaut /tmp/ui-bundle.js)
"""
import json
import sys

BUNDLE = sys.argv[1] if len(sys.argv) > 1 else "/tmp/ui-bundle.js"
ASSETS = "/home/z/my-project/arvys-assets"
OUT = "/home/z/my-project/arvys-brand-logos.js"

data = open(BUNDLE, encoding="utf-8", errors="replace").read()


def extract_template(anchor):
    """Retourne la chaîne du gabarit P('...') contenant l'ancre donnée."""
    i = data.find(anchor)
    if i < 0:
        raise SystemExit("ancre introuvable : %r" % anchor[:60])
    svg_start = data.rfind("<svg", 0, i)
    tpl = data.rfind("P('", 0, svg_start)
    if tpl < 0 or svg_start < 0:
        raise SystemExit("gabarit introuvable pour l'ancre : %r" % anchor[:60])
    j = svg_start
    while True:
        j = data.find("'", j + 1)
        if j < 0:
            raise SystemExit("fin de chaîne introuvable")
        bs, k = 0, j - 1
        while data[k] == "\\":
            bs += 1
            k -= 1
        if bs % 2 == 0:
            break
    return data[tpl + 3:j]


def svg_inner(svg_text):
    """Contenu interne d'un fichier SVG (entre la balise <svg…> ouvrante et la fermante)."""
    a = svg_text.find(">")
    b = svg_text.rfind("</svg>")
    return svg_text[a + 1:b]


def check_clean(s, name):
    if "'" in s or "\\" in s:
        raise SystemExit("%s : caractère ' ou \\ interdit dans le remplacement" % name)
    if "</scr" + "ipt>" in s.lower():
        raise SystemExit("%s : balise script interdite" % name)


# --- Chaînes « find » (extraites du bundle, byte-exact) ----------------------
find_wordmark = extract_template('viewBox="0 0 234 42"')
find_mark = extract_template("data-component=logo-mark")
find_splash = extract_template("data-component=logo-splash")

for name, s, n in (("wordmark", find_wordmark, 1), ("mark", find_mark, 1), ("splash", find_splash, 1)):
    c = data.count(s)
    if c != n:
        raise SystemExit("%s : %d occurrences dans le bundle (attendu %d)" % (name, c, n))

# --- Remplacements ARVYS -----------------------------------------------------
wordmark_file = open(ASSETS + "/wordmark-inline.svg", encoding="utf-8").read().strip()
mark_file = open(ASSETS + "/mark-inline.svg", encoding="utf-8").read().strip()

# 1) Wordmark du héros : gabarit original = <svg viewBox="0 0 234 42"><g>…paths…
#    On garde la géométrie EXACTE de la boîte (viewBox 234×42 + un <g>) et on
#    centre la marque ARVYS (210×42, lettres y6..36) : +12 en x, +6 en y.
repl_wordmark = (
    '<svg xmlns=http://www.w3.org/2000/svg viewBox="0 0 234 42"fill=none>'
    '<g transform="translate(12 6)">' + svg_inner(wordmark_file) + "</g></svg>"
)

# 2) Marque (coin/interface) : remplacement 1:1 conçu à l'origine (même
#    composant logo-mark, mêmes 2 paths, viewBox 18×30 — aspect préservé
#    par preserveAspectRatio par défaut).
repl_mark = mark_file

# 3) Splash : même structure DOM (svg > 2 paths), viewBox aligné sur la marque.
head = find_splash[: find_splash.find(">") + 1]  # balise <svg …> originale
head = head.replace('viewBox="0 0 80 100"', 'viewBox="0 0 18 30"')
repl_splash = head + svg_inner(mark_file) + "</svg>"

for name, s in (("wordmark", repl_wordmark), ("mark", repl_mark), ("splash", repl_splash)):
    check_clean(s, name)

module = (
    '"use strict";\n'
    "// Généré par scripts/build_logo_swaps.py — NE PAS ÉDITER À LA MAIN.\n"
    "// Chaînes EXACTES des gabarits SVG « opencode » du bundle UI (index-*.js)\n"
    "// + remplacements ARVYS (assets wordmark-inline.svg / mark-inline.svg).\n"
    "// Si le binaire est mis à jour et que les gabarits changent, relancer :\n"
    "//   curl le bundle puis python3 scripts/build_logo_swaps.py <bundle>\n"
    "module.exports = " + json.dumps(
        {
            "find": {"wordmark": find_wordmark, "mark": find_mark, "splash": find_splash},
            "repl": {"wordmark": repl_wordmark, "mark": repl_mark, "splash": repl_splash},
        },
        ensure_ascii=False,
        indent=2,
    ) + ";\n"
)

with open(OUT, "w", encoding="utf-8") as f:
    f.write(module)

print("OK →", OUT)
print("  find wordmark :", len(find_wordmark), "chars")
print("  find mark     :", len(find_mark), "chars")
print("  find splash   :", len(find_splash), "chars")
print("  repl wordmark :", len(repl_wordmark), "chars")
print("  repl mark     :", len(repl_mark), "chars")
print("  repl splash   :", len(repl_splash), "chars")
