# ARVYS CODE

Agent de codage IA, terminal-native, propulsé par deux modèles internes.

## Aperçu

![ARVYS Code — nouvelle session](docs/screenshots/ui-hero.png)

![ARVYS Code — mobile (PWA)](docs/screenshots/ui-mobile.png)

## Présentation

ARVYS Code est un agent de développement qui vit dans le terminal : il lit votre code, l'écrit, le corrige et l'exécute sous vos ordres. Le moteur open-source opencode a été intégralement rebrandé et étendu avec deux modèles d'IA internes et un produit web complet — téléchargement APK Android, PWA iPhone réelle et application navigateur.

Le moteur est **opencode v2 (2.0.22)**, installé via le paquet npm officiel `@opencode/cli` — nouvelle interface web native (responsive mobile, terminal PTY intégré, temps réel SSE). Le rebranding est appliqué **à la volée par le cœur** (`proxy-core.js`) : textes, titres, manifest et marques remplacés dans chaque réponse. Le binaire agent reste officiel et jamais modifié, pour la stabilité.

## Fonctionnalités

- **Deux IA internes**
  - `arvys-code` — le raisonneur : architecture, refactoring, débogage complexe
  - `arvys-flash` — le rapide : complétions, questions courtes, itérations instantanées
  - Bascule automatique et transparente entre modèles ; API compatible OpenAI (`/v1/chat/completions`, streaming SSE)
- **Terminal intégré** — exécution de commandes côté serveur via un pont PTY
- **APK Android réel** — binaire complet packagé, prêt à installer (`/download`)
- **PWA iPhone réelle** — manifest standalone + service worker : « Ajouter à l'écran d'accueil » installe la vraie application
- **Application navigateur** — la même UI complète sur desktop
- **Rebranding intégral** — logos, wordmark, écrans de démarrage ARVYS appliqués jusqu'au bundle UI

## Architecture

```
ARVYS Code (:3000)   cœur public — UI, API, ponts SSE / PTY / vocal
├── Agent (:3001)    binaire agent officiel, jamais modifié
└── Passerelle IA (:3002)   endpoint compatible OpenAI des 2 modèles internes
```

| Chemin | Rôle |
|---|---|
| `proxy-core.js` | Le cœur : sert l'UI, proxifie l'agent, expose les ponts |
| `gateway/arvys_zai_gateway.js` | Passerelle des 2 modèles : chaînes de bascule, streaming, timeouts |
| `arvys-cloud/` | La vitrine : `/download`, `/chat`, manifest PWA, service worker, APK (l'interface v2 est servie en direct par le cœur) |
| `.zscripts/dev.sh` | Superviseur de démarrage (relance automatique du cœur) |

## Démarrage

```bash
# 1) Dépendances — installe aussi le binaire agent v2 via @opencode/cli
npm install        # ou bun install

# 2) Binaire agent (~200 Mo, non versionné dans git)
mkdir -p oc-bin
cp node_modules/@opencode/cli-linux-x64/bin/opencode oc-bin/opencode-custom
chmod +x oc-bin/opencode-custom

# 3) Lancer — la config des 2 modèles internes (config/opencode.jsonc) est
#    injectée automatiquement par le cœur, l'authentification de l'agent v2
#    est portée par le proxy : rien d'autre à faire.
node proxy-core.js
# → http://localhost:3000
```

Le cœur spawn et supervise lui-même l'agent (:3001) et la passerelle IA (:3002). La passerelle lit sa configuration dans `gateway/cf-ai.json` (non versionné) :

```json
{ "account_id": "...", "api_token": "..." }
```

ou par les variables d'environnement équivalentes. Sans configuration, les endpoints IA répondent 503 proprement.

## Pages web

| Page | Rôle |
|---|---|
| `/` | L'application complète (UI de l'agent) |
| `/download` | Téléchargement de l'APK Android |
| `/chat` | Chat de secours vers les 2 IA |

## Roadmap

- **Cerveau additionnel** — un troisième modèle avancé viendra compléter `arvys-code` et `arvys-flash`
- Déploiement multi-plateformes étendu

## Crédits

Basé sur le projet open-source [opencode](https://github.com/sst/opencode) (MIT), rebrandé et étendu par ARVYS.
