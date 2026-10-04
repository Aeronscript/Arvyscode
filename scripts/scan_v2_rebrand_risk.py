#!/usr/bin/env python3
"""Scan tous les chunks JS v2 : compare rebrand naïf vs rebrand à frontières
d'identifiants, et valide la syntaxe ESM (node --check) des deux versions."""
import os, re, subprocess, sys, tempfile

RISKY = re.compile(r'''(?<![\w$])(?:\.\s*)?(?:OpenCode|Opencode|OPENCODE)(?![\w$])\s*:|[\{,]\s*(?:OpenCode|Opencode|OPENCODE)\s*:|\.(?:OpenCode|Opencode)(?![\w$])|(?:class|function|const|let|var|new)\s+(?:OpenCode|Opencode|OPENCODE)(?![\w$])''')

BOUNDARY = [
    (re.compile(r'(?<![\w$.])OpenCode Zen(?![\w$])'), 'Arvys Cloud'),
    (re.compile(r'(?<![\w$.])OPENCODE(?![\w$])'), 'ARVYS'),
    (re.compile(r'(?<![\w$.])OpenCode(?![\w$])'), 'Arvys Code'),
    (re.compile(r'(?<![\w$.])Opencode(?![\w$])'), 'Arvys Code'),
]
NAIVE = [("OpenCode Zen", "Arvys Cloud"), ("OPENCODE", "ARVYS"),
         ("OpenCode", "Arvys Code"), ("Opencode", "Arvys Code")]

def naive(t):
    for a, b in NAIVE:
        if a in t: t = t.split(a).join(b) if False else t.replace(a, b)
    return t

def boundary(t):
    for rx, b in BOUNDARY:
        t = rx.sub(b, t)
    return t

def check_esm(path):
    r = subprocess.run(['node', '--check', path], capture_output=True, text=True)
    return r.returncode == 0, (r.stderr or '')[-200:]

bad_naive, bad_boundary, risky_hits = [], [], []
d = sys.argv[1] if len(sys.argv) > 1 else '/tmp/v2-chunks'
for f in sorted(os.listdir(d)):
    if not f.endswith('.js'): continue
    src = open(os.path.join(d, f), encoding='utf-8', errors='surrogatepass').read()
    for m in RISKY.finditer(src):
        risky_hits.append((f, src[max(0, m.start()-40):m.end()+40]))
    nb, bb = naive(src), boundary(src)
    with tempfile.NamedTemporaryFile('w', suffix='.mjs', delete=False, encoding='utf-8') as t1:
        t1.write(nb); p1 = t1.name
    with tempfile.NamedTemporaryFile('w', suffix='.mjs', delete=False, encoding='utf-8') as t2:
        t2.write(bb); p2 = t2.name
    ok1, e1 = check_esm(p1)
    ok2, e2 = check_esm(p2)
    os.unlink(p1); os.unlink(p2)
    if not ok1: bad_naive.append((f, e1.strip().splitlines()[-1] if e1.strip() else '?'))
    if not ok2: bad_boundary.append((f, e2.strip().splitlines()[-1] if e2.strip() else '?'))

print(f'chunks scannés: {len([f for f in os.listdir(d) if f.endswith(".js")])}')
print(f'\n== patterns risqués (bare keys / accès propriété / déclarations) dans le RAW: {len(risky_hits)}')
for f, ctx in risky_hits[:10]:
    print(f'  {f}: {ctx!r}')
print(f'\n== rebrand NAÏF casse la syntaxe: {len(bad_naive)} chunks')
for f, e in bad_naive: print(f'  ✗ {f}: {e}')
print(f'\n== rebrand FRONTIÈRES casse la syntaxe: {len(bad_boundary)} chunks')
for f, e in bad_boundary: print(f'  ✗ {f}: {e}')
