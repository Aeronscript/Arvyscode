#!/bin/bash
# dev.sh — point d'entrée plateforme z.ai (exécuté au boot du conteneur, comme
# les autres services root-managed qui, eux, survivent : caddy, runtime ZAI).
#
# Architecture ARVYS Code :
#   node proxy-core.js  :3000 (public, rebranding complet, ponts SSE/PTY/vocal)
#     └─ spawn binaire ARVYS        :3001 (opencode officiel, jamais modifié)
#     └─ spawn passerelle z.ai      :3002 (OpenAI-compatible, SDK z.ai)
#
# Boucle de supervision : si le cœur meurt, relance en 3 s, indéfiniment.
cd /home/z/my-project || exit 1
LOG=/tmp/arvys-boot.log
echo "[dev.sh] démarrage superviseur $(date '+%F %T')" >> "$LOG"

# Garde-fou : la passerelle importe z-ai-web-dev-sdk ; si node_modules manque
# (recopie froide), on réinstalle une seule fois avant d'entrer dans la boucle.
if [ ! -d node_modules/z-ai-web-dev-sdk ]; then
  echo "[dev.sh] node_modules incomplet — bun install…" >> "$LOG"
  bun install >> "$LOG" 2>&1
fi

while true; do
  node proxy-core.js >> "$LOG" 2>&1
  echo "[dev.sh] cœur sorti code=$? $(date '+%F %T') — relance dans 3 s" >> "$LOG"
  sleep 3
done
