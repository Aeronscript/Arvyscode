#!/bin/sh
# Superviseur Arvys Code : garantit que le serveur tourne en permanence.
# Relance `next start` (port 3000) s'il meurt ; l'instrumentation Next
# spawn elle-même le cœur (proxy-core :3011 → binaire :3001 + passerelle :3002).
cd /home/z/my-project || exit 1
LOG=/tmp/arvys-serve.log
echo "[superviseur] démarrage $(date '+%F %T')" >> "$LOG"
while true; do
  node node_modules/next/dist/bin/next start -p 3000 >> "$LOG" 2>&1
  echo "[superviseur] serveur sorti code=$? $(date '+%F %T') — relance dans 3 s" >> "$LOG"
  sleep 3
done
