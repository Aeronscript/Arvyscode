// E2E pont PTY : simulateur de FakeWS côté Node (même protocole que le shim)
import http from "node:http";

const PORT = parseInt(process.argv[2] || "3000", 10);

function req(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? (Buffer.isBuffer(body) ? body : Buffer.from(body)) : null;
    const r = http.request({ host: "127.0.0.1", port: PORT, method, path, headers: {
      ...(data ? { "content-length": data.length } : {}),
      ...headers,
    } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks) }));
    });
    r.on("error", reject);
    r.setTimeout(30000, () => r.destroy(new Error("timeout")));
    if (data) r.write(data);
    r.end();
  });
}

const j = (r) => JSON.parse(r.buf.toString("utf8"));

// 1) créer un PTY + ticket — cwd = répertoire projet du binaire (renvoyé par
//    le create lui-même : un cwd hors projet fait mourir le PTY → 404 au connect)
const probe = j(await req("POST", "/api/pty", JSON.stringify({ command: "bash", title: "bridge-e2e-probe" })));
const dir = probe.location?.directory || probe.data?.location?.directory || "/home/z/my-project";
const created = j(await req("POST", "/api/pty", JSON.stringify({ command: "bash", cwd: dir, title: "bridge-e2e" })));
const ptyID = created.data.id;
const tok = j(await req("POST", `/api/pty/${ptyID}/connect-token`, null, { "x-opencode-ticket": "1" }));
console.log("1) PTY créé:", ptyID, "dir:", dir, "ticket:", tok.data?.ticket ? "oui" : "non");

// 2) open via le pont
const url = `http://x/api/pty/${ptyID}/connect?ticket=${encodeURIComponent(tok.data.ticket)}&location%5Bdirectory%5D=${encodeURIComponent(dir)}`;
const opened = j(await req("POST", "/__ptybridge/open", JSON.stringify({ url }), { "content-type": "application/json" }));
if (!opened.id) { console.log("ECHEC open:", opened); process.exit(1); }
console.log("2) flux ouvert:", opened.id);

// 3) recv initial → attendre {"cursor":0}
let seq = 0;
async function recvOnce() {
  const r = j(await req("GET", `/__ptybridge/${opened.id}/recv?since=${seq}&wait=12000`));
  seq = r.last ?? seq;
  return r;
}
let first = await recvOnce();
let all = first.frames || [];
// attendre jusqu'à voir la sortie de la commande (max ~8 tours)
let sent = false;
for (let i = 0; i < 8 && !all.some((f) => f.op === 1 && Buffer.from(f.d, "base64").toString().includes("arvys_bridge_done")); i++) {
  const r = await recvOnce();
  all = all.concat(r.frames || []);
  // dès qu'un prompt shell apparaît (ou rien du tout au 1er tour), envoyer la commande
  if (!sent && (i === 0 || all.some((f) => f.op === 1))) {
    await req("POST", `/__ptybridge/${opened.id}/send`, "echo arvys_bridge_done $(date +%s)\n", { "content-type": "text/plain;charset=UTF-8" });
    sent = true;
    console.log("3) commande envoyée (trame texte)");
  }
}
const text = all.filter((f) => f.op === 1).map((f) => Buffer.from(f.d, "base64").toString("utf8")).join("");
console.log("4) trames texte reçues:", all.filter((f) => f.op === 1).length, "— extrait:", JSON.stringify(text.slice(0, 160)));
const ok = text.includes("arvys_bridge_done");
console.log(ok ? "5) TERMINAL VIA PONT : OK ✓" : "5) TERMINAL VIA PONT : ÉCHEC ✗");

await req("POST", `/__ptybridge/${opened.id}/close`, "", { "content-type": "text/plain" });
console.log("6) flux fermé proprement");
process.exit(ok ? 0 : 1);
