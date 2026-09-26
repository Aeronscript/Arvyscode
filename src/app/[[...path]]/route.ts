/**
 * Route catch-all — miroir HTTP vers le cœur applicatif ARVYS (proxy-core.js,
 * spawné par src/instrumentation.ts). Toutes les méthodes, tous les chemins :
 * l'app, les API, les ponts SSE/terminal, les shims, /download, /apk/*, icônes.
 *
 * [[...path]] (optional catch-all) couvre aussi « / ».
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CORE_PORT = process.env.PROXY_CORE_PORT || "3011";
const CORE = `http://127.0.0.1:${CORE_PORT}`;

// En-têtes hop-by-hop à ne pas relayer (+ host/content-length recalculés par fetch)
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "host",
  "content-length",
]);

async function mirror(req: Request): Promise<Response> {
  const incoming = new URL(req.url);
  const target = CORE + incoming.pathname + incoming.search;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });

  const init: RequestInit = { method: req.method, headers, redirect: "manual", cache: "no-store" };
  if (req.method !== "GET" && req.method !== "HEAD") {
    try {
      const body = await req.arrayBuffer();
      if (body.byteLength > 0) init.body = body;
    } catch (e) {}
  }

  try {
    const res = await fetch(target, init);
    const out = new Headers();
    res.headers.forEach((value, key) => {
      const k = key.toLowerCase();
      if (HOP_BY_HOP.has(k)) return;
      // le cœur envoie toujours de l'identité (accept-encoding forcé) ;
      // on retire un éventuel content-encoding résiduel pour éviter un corps illisible
      if (k === "content-encoding") return;
      out.set(key, value);
    });
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: out,
    });
  } catch (e: any) {
    // proxy-core pas encore prêt (démarrage, crash, spawn en cours)
    return new Response(
      JSON.stringify({
        error: "Le service démarre… ou est momentanément indisponible.",
        hint: "Rechargez dans quelques secondes. La page d'installation est disponible sur /download.",
        detail: String((e && e.message) || e),
      }),
      {
        status: 503,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "retry-after": "2",
        },
      }
    );
  }
}

export const GET = mirror;
export const POST = mirror;
export const PUT = mirror;
export const PATCH = mirror;
export const DELETE = mirror;
export const OPTIONS = mirror;
export const HEAD = mirror;
