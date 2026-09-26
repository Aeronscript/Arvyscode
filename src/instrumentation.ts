/**
 * Instrumentation Next.js — démarre le cœur applicatif ARVYS (proxy-core.js)
 * à côté du serveur Next de la plateforme (next start OU serveur standalone).
 *
 * proxy-core.js : spawn binaire ARVYS (:3001) + passerelle (:3002) + TOUTE la
 * couche (anti-cache, rebranding, ponts SSE & terminal, vocal, /download, APK).
 * La route catch-all src/app/[[...path]]/route.ts renvoie ensuite tout le
 * HTTP public vers ce processus via PROXY_CORE_PORT (défaut 3011).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Tire le SDK z.ai dans le graphe du build : sans cet import, le traceur
  // ne l'embarque pas et la passerelle ne peut plus le résoudre au runtime.
  try { await import("z-ai-web-dev-sdk"); } catch (e) {}
  const { spawn } = await import("node:child_process");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const net = await import("node:net");

  const CORE_PORT = process.env.PROXY_CORE_PORT || "3011";

  const portBusy = (port: number) =>
    new Promise<boolean>((resolve) => {
      const s = net.connect({ host: "127.0.0.1", port });
      const done = (v: boolean) => {
        try { s.destroy(); } catch (e) {}
        resolve(v);
      };
      s.on("connect", () => done(true));
      s.on("error", () => done(false));
      setTimeout(() => done(true), 700);
    });

  if (await portBusy(Number(CORE_PORT))) {
    console.log(`[arvys-core] :${CORE_PORT} déjà actif — pas de spawn`);
    return;
  }

  // Le runtime plateforme peut démarrer depuis un autre cwd :
  // on cherche proxy-core.js depuis le cwd puis vers la racine du projet.
  const bases = [
    process.cwd(),
    path.join(process.cwd(), "next-service-dist"), // start.sh : cwd parent du dist
    path.resolve(process.cwd(), ".."),
    path.resolve(process.cwd(), "../.."),
    path.resolve(process.cwd(), "../../.."),
  ];
  let corePath = "";
  for (const b of bases) {
    const p = path.join(b, "proxy-core.js");
    try {
      if (fs.existsSync(p)) { corePath = p; break; }
    } catch (e) {}
  }
  if (!corePath) {
    console.error("[arvys-core] proxy-core.js introuvable — bases testées : " + bases.join(" | "));
    return;
  }

  const spawnCore = async () => {
    if (await portBusy(Number(CORE_PORT))) return;
    try {
      // Préférer un vrai binaire node : si la plateforme exécute Next sous Bun,
      // process.execPath est bun et le cœur (serveur http node) y est plus
      // exposé aux quirks de framing. /usr/bin/node existe sur l'image déploiement.
      let nodeBin: string = process.execPath;
      if (!nodeBin.endsWith("node")) {
        for (const cand of ["/usr/local/bin/node", "/usr/bin/node", "/bin/node"]) {
          try {
            if (fs.existsSync(cand)) { nodeBin = cand; break; }
          } catch (e) {}
        }
      }
      const child = spawn(nodeBin, [corePath], {
        cwd: path.dirname(corePath),
        env: { ...process.env, PROXY_CORE_PORT: CORE_PORT },
        stdio: ["ignore", "inherit", "inherit"],
      });
      console.log(`[arvys-core] spawn pid=${child.pid} : ${corePath} (:${CORE_PORT})`);
      child.on("exit", (code) => {
        console.error(`[arvys-core] exit ${code} — relance dans 3 s`);
        setTimeout(spawnCore, 3000);
      });
      child.on("error", (e) => {
        console.error(`[arvys-core] spawn error: ${e.message}`);
      });
    } catch (e: any) {
      console.error(`[arvys-core] exception spawn: ${e && e.message}`);
    }
  };
  await spawnCore();
}
