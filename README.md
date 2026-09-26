# ARVYS CODE

Agent de codage IA, terminal-native, propulsé par deux modèles internes.

## Présentation

ARVYS Code est un agent de développement qui vit dans le terminal : il lit votre code, l'écrit, le corrige et l'exécute sous vos ordres. Le moteur open-source opencode a été intégralement rebrandé et étendu avec deux modèles d'IA internes et un produit web complet — téléchargement APK Android, PWA iPhone réelle et application navigateur.

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
| `arvys-cloud/` | Le produit web : UI complète, `/download`, `/chat`, manifest PWA, service worker, APK |
| `.zscripts/dev.sh` | Superviseur de démarrage (relance automatique du cœur) |

## Démarrage

```bash
bun install
node proxy-core.js
# → http://localhost:3000
```

La passerelle IA lit sa configuration dans `gateway/cf-ai.json` (non versionné) :

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
