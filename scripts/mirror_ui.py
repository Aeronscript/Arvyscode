#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Miroite l'UI complète (SPA) servie par le cœur ARVYS local (127.0.0.1:3000).

Le cœur doit tourner AVANT l'appel (bash : `node proxy-core.js &` puis sleep).
Parcours BFS : index.html → assets (js/css/png/svg/ico/webmanifest/fonts) →
références internes aux bundles (chunks Vite, url() CSS). Sauvegarde sous
arvys-cloud/ui-src/ en conservant les chemins d'origine.
"""
import os
import re
import sys
import urllib.request

BASE = "http://127.0.0.1:3000"
OUT = "/home/z/my-project/arvys-cloud/ui-src"
EXTS = (".js", ".css", ".png", ".svg", ".ico", ".webmanifest", ".json",
        ".woff2", ".woff", ".ttf", ".otf", ".mp3", ".webp", ".jpg", ".html")

os.makedirs(OUT, exist_ok=True)
seen, queue = set(), ["/"]

REF_RE = re.compile(r'(?:href|src|from|import)[=(\["\']\s*["\'(]?\s*(/assets/[A-Za-z0-9_./-]+\.(?:js|css|woff2?|ttf|png|svg))')
CSS_URL_RE = re.compile(r'url\(\s*["\']?(/[A-Za-z0-9_./-]+\.(?:woff2?|ttf|otf|png|svg|ico))["\']?\s*\)')
HTML_REF_RE = re.compile(r'(?:href|src)="(/[^"?]+)"')


def fetch(path):
    url = BASE + path
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return r.read(), r.headers.get("Content-Type", "")
    except Exception as e:
        print("  !! échec %s : %s" % (path, e))
        return None, ""


def save(path, data):
    if path == "/" or path.endswith("/"):
        path = path + "index.html"
    full = os.path.join(OUT, path.lstrip("/"))
    os.makedirs(os.path.dirname(full) or OUT, exist_ok=True)
    with open(full, "wb") as f:
        f.write(data)
    print("  ✓ %-42s %8d o" % (path, len(data)))


def is_asset(path):
    return path.lower().endswith(EXTS) and path not in seen and path.startswith("/")


while queue:
    path = queue.pop(0)
    if path in seen:
        continue
    seen.add(path)
    data, ct = fetch(path)
    if data is None:
        continue
    save(path, data)
    text = data.decode("utf-8", errors="replace")
    refs = set()
    if path == "/" or path.endswith(".html"):
        refs.update(m.group(1) for m in HTML_REF_RE.finditer(text))
    if path.endswith(".css"):
        refs.update(m.group(1) for m in CSS_URL_RE.finditer(text))
        refs.update(m.group(1) for m in REF_RE.finditer(text))
    if path.endswith(".js"):
        refs.update(m.group(1) for m in REF_RE.finditer(text))
        refs.update(m.group(1) for m in CSS_URL_RE.finditer(text))
    for r in refs:
        if is_asset(r) and "://" not in r:
            queue.append(r)

total = 0
files = 0
for root, _, names in os.walk(OUT):
    for n in names:
        total += os.path.getsize(os.path.join(root, n))
        files += 1
print("MIROIR TERMINÉ : %d fichiers, %.2f Mo" % (files, total / 1048576))
