/**
 * Passerelle ARVYS — endpoint compatible OpenAI → Cloudflare Workers AI
 *
 *  GET  /health                    → { ok, service, models, provider }
 *  POST /v1/chat/completions       → chat.completions (arvys-code / arvys-flash)
 *  POST /chat/completions          → alias
 *
 * Fournisseur : Workers AI (REST api.cloudflare.com) — PLUS AUCUNE dépendance
 * au SDK z.ai ni à l'API interne z.ai (verrou RFC1918 contourné : les 2 IA
 * deviennent portables, ici, sur un VPS ou ailleurs).
 *
 * Identifiants : env CF_ACCOUNT_ID + CF_AI_TOKEN, sinon gateway/cf-ai.json
 * {"account_id","api_token"} (fichier gitignore). Sans identifiants :
 * /health ok:true + provider:"none" et les chats répondent 503.
 *
 * Modèles (bascule automatique si indisponible — ex. plan Workers Free) :
 *   arvys-code  → @cf/deepseek-ai/deepseek-v4-flash-0731
 *               → repli @cf/meta/llama-3.1-8b-instruct-fp8
 *   arvys-flash → @cf/meta/llama-3.1-8b-instruct-fp8
 *               → repli @cf/meta/llama-3.2-3b-instruct
 *
 * stream:true → SSE chat.completion.chunk ; stream:false → JSON OpenAI.
 */
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = parseInt(process.env.GATEWAY_PORT || "3002", 10);
const MODELS = ["arvys-code", "arvys-flash"];

const GROQ_KEY = process.env.GROQ_API_KEY || "";
const GROQ_MODELS = {
  "arvys-code": [
    "openai/gpt-oss-120b",
    "llama-3.3-70b-versatile",
    "qwen/qwen3.6-27b",
    "qwen-2.5-32b",
    "moonshotai/kimi-k2-instruct",
    "mixtral-8x7b-32768"
  ],
  "arvys-flash": [
    "openai/gpt-oss-20b",
    "llama-3.1-8b-instant",
    "llama-3.2-3b-preview",
    "llama-3.2-1b-preview",
    "gemma2-9b-it"
  ],
};

let dynamicGroqModels = null;
let lastModelFetch = 0;

async function getAvailableGroqModels() {
  const now = Date.now();
  if (dynamicGroqModels && now - lastModelFetch < 300000) {
    return dynamicGroqModels;
  }
  if (!GROQ_KEY) return null;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 4000);
    const r = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${GROQ_KEY}` },
      signal: ac.signal,
    });
    clearTimeout(t);
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data.data)) {
        dynamicGroqModels = data.data.map((m) => m.id);
        lastModelFetch = now;
        console.log("[arvys-gateway] Modèles Groq actifs détectés :", dynamicGroqModels.length);
        return dynamicGroqModels;
      }
    }
  } catch (e) {
    // Échec doux, on continue avec les modèles par défaut
  }
  return null;
}

// Quota journalier (20 requêtes gratuites par jour, remise à zéro à 00:00 UTC)
const DAILY_LIMIT = 20;
let dailyCount = 0;
let currentDay = new Date().toISOString().slice(0, 10);

function checkQuota() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== currentDay) {
    currentDay = today;
    dailyCount = 0;
  }
  if (dailyCount >= DAILY_LIMIT) {
    return {
      allowed: false,
      count: dailyCount,
      limit: DAILY_LIMIT,
      reset: "00:00 UTC",
    };
  }
  dailyCount += 1;
  return {
    allowed: true,
    count: dailyCount,
    limit: DAILY_LIMIT,
    remaining: DAILY_LIMIT - dailyCount,
  };
}

const CHAIN = {
  "arvys-code": [
    "@cf/deepseek-ai/deepseek-v4-flash-0731",
    "@cf/meta/llama-3.1-8b-instruct-fp8",
  ],
  "arvys-flash": [
    "@cf/meta/llama-3.1-8b-instruct-fp8",
    "@cf/meta/llama-3.2-3b-instruct",
  ],
};

// --- Identifiants Workers AI -------------------------------------------------
function loadCreds() {
  if (process.env.CF_ACCOUNT_ID && process.env.CF_AI_TOKEN) {
    return { account: process.env.CF_ACCOUNT_ID, token: process.env.CF_AI_TOKEN };
  }
  try {
    const f = JSON.parse(
      fs.readFileSync(path.join(__dirname, "cf-ai.json"), "utf8")
    );
    if (f.account_id && f.api_token) {
      return { account: f.account_id, token: f.api_token };
    }
  } catch (e) {}
  return null;
}
const CREDS = loadCreds();
const PROVIDER = GROQ_KEY ? "groq" : CREDS ? "workers-ai" : "none";


// --- Utilitaires -------------------------------------------------------------
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

// Modèle indisponible (plan Free, modèle retiré, etc.) → bascule possible
function isUnavailable(status, text) {
  return (
    status === 403 ||
    status === 503 ||
    status === 404 ||
    /not available|No such model|5035|deprecated/i.test(String(text || ""))
  );
}

// Texte d'une réponse Workers AI non streamée (formes variées selon modèles)
function pickText(result) {
  if (!result) return "";
  if (typeof result.response === "string") return result.response;
  if (Array.isArray(result.choices) && result.choices[0]) {
    const m = result.choices[0].message || result.choices[0].delta || {};
    return m.content || "";
  }
  if (typeof result.output_text === "string") return result.output_text;
  return "";
}

// Delta texte d'un chunk SSE Workers AI (formes variées selon modèles)
function pickDelta(j) {
  if (typeof j.response === "string") return j.response;
  if (Array.isArray(j.choices) && j.choices[0]) {
    const d = j.choices[0].delta || j.choices[0].message || {};
    return d.content || "";
  }
  return "";
}

async function runOnce(model, messages, reqBody) {
  const payload = {
    messages,
    max_tokens: Math.min(parseInt(reqBody.max_tokens, 10) || 2048, 8192),
    temperature: typeof reqBody.temperature === "number" ? reqBody.temperature : 0.6,
    stream: !!reqBody.stream,
  };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 120000);
  let r, data;
  try {
    r = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CREDS.account}/ai/run/${model}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CREDS.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: ac.signal,
      }
    );
    if (payload.stream) {
      // En streaming, on renvoie la réponse telle quelle (le corps SSE est
      // consommé par streamToClient) — pas de décodage JSON ici.
      clearTimeout(timer);
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        const err = new Error(`HTTP ${r.status} ${txt.slice(0, 200)}`);
        err.unavailable = isUnavailable(r.status, txt);
        throw err;
      }
      return { stream: r.body };
    }
    data = await r.json().catch(() => ({}));
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
  clearTimeout(timer);
  if (!r.ok || data.success === false) {
    const msg =
      (data.errors && data.errors[0] && data.errors[0].message) ||
      `HTTP ${r.status}`;
    const err = new Error(msg);
    err.unavailable = isUnavailable(r.status, msg);
    throw err;
  }
  return { text: pickText(data.result) };
}

async function chatCompletions(req, res) {
  const chunks = [];
  let size = 0;
  req.on("data", (c) => {
    size += c.length;
    if (size <= 16 * 1024 * 1024) chunks.push(c);
  });
  req.on("end", async () => {
    let reqBody;
    try {
      reqBody = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch (e) {
      return json(res, 400, { error: { message: "JSON invalide", type: "invalid_request_error" } });
    }
    const askedModel = String(reqBody.model || "arvys-code");
    const chain = CHAIN[askedModel] ? askedModel : "arvys-code";
    const messages = (Array.isArray(reqBody.messages) ? reqBody.messages : [])
      .filter((m) => m && typeof m.content === "string" && ["system", "user", "assistant"].includes(m.role))
      .map((m) => ({ role: m.role, content: m.content }));
    if (!messages.length) {
      return json(res, 400, { error: { message: "messages requis", type: "invalid_request_error" } });
    }

    // Fournisseur 1 : Groq avec quota de 20 requêtes/jour par défaut
    if (PROVIDER === "groq") {
      const q = checkQuota();
      if (!q.allowed) {
        return json(res, 429, {
          error: {
            message: "Quota quotidien atteint (20 requêtes gratuites/jour). Réinitialisation à 00:00 UTC. Vous pouvez également renseigner votre propre clé API dans les paramètres pour un usage illimité.",
            type: "insufficient_quota",
            code: "daily_limit_reached",
          },
        });
      }
      return handleGroqChat(askedModel, messages, reqBody, res);
    }

    // Fournisseur 2 : Workers AI (secours)
    if (PROVIDER !== "workers-ai") {
      return json(res, 503, {
        error: {
          message: "Aucun fournisseur IA configuré. Configurez GROQ_API_KEY dans les variables d'environnement.",
          type: "server_error",
        },
      });
    }

    // Bascule automatique dans la chaîne de modèles Workers AI
    let lastErr = null;
    for (const model of CHAIN[chain]) {
      try {
        const out = await runOnce(model, messages, reqBody);
        if (out.stream) {
          return streamToClient(out.stream, askedModel, model, res);
        }
        res.setHeader("x-arvys-model", model);
        return json(res, 200, {
          id: "chatcmpl-arvys-" + Date.now().toString(36),
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: askedModel,
          choices: [
            { index: 0, message: { role: "assistant", content: out.text }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
      } catch (e) {
        lastErr = e;
        console.error(`[arvys-gateway] ${model} indisponible : ${e && e.message}`);
        if (!e.unavailable) break; // erreur non liée au modèle → inutile d'essayer le suivant
      }
    }
    json(res, 502, {
      error: { message: String((lastErr && lastErr.message) || lastErr), type: "server_error" },
    });
  });
  req.on("error", () => {
    try { res.destroy(); } catch (e) {}
  });
}

// SSE Workers AI → SSE OpenAI (chat.completion.chunk)
function streamToClient(src, askedModel, actualModel, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const id = "chatcmpl-arvys-" + Date.now().toString(36);
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  send({
    id,
    object: "chat.completion.chunk",
    model: askedModel,
    choices: [{ index: 0, delta: { role: "assistant" } }],
  });
  const reader = src.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const pump = async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const t = pickDelta(JSON.parse(payload));
            if (t) {
              send({
                id,
                object: "chat.completion.chunk",
                model: askedModel,
                choices: [{ index: 0, delta: { content: t } }],
              });
            }
          } catch (e) {}
        }
      }
      send({
        id,
        object: "chat.completion.chunk",
        model: askedModel,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      });
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (e) {
      try { res.end(); } catch (e2) {}
    }
  };
  pump();
}

async function handleGroqChat(askedModel, messages, reqBody, res) {
  const isStream = !!reqBody.stream;
  let modelsToTry = [...(GROQ_MODELS[askedModel] || GROQ_MODELS["arvys-code"])];

  // Découverte dynamique : si on a pu lister les modèles du compte, on priorise ceux qui sont actifs
  const activeIds = await getAvailableGroqModels();
  if (Array.isArray(activeIds) && activeIds.length > 0) {
    const activeSet = new Set(activeIds);
    const existing = modelsToTry.filter((m) => activeSet.has(m));
    const others = modelsToTry.filter((m) => !activeSet.has(m));
    // S'il y a d'autres modèles compatibles sur le compte, on les ajoute en repli
    const discovered = activeIds.filter((id) =>
      /gpt-oss|llama-3\.[23]|qwen|mixtral|gemma/i.test(id) && !modelsToTry.includes(id)
    );
    modelsToTry = [...existing, ...others, ...discovered];
  }

  let lastErrText = "";
  let lastStatus = 502;

  for (const m of modelsToTry) {
    const payload = {
      model: m,
      messages,
      max_tokens: Math.min(parseInt(reqBody.max_tokens, 10) || 4096, 8192),
      temperature: typeof reqBody.temperature === "number" ? reqBody.temperature : 0.6,
      stream: isStream,
    };
    try {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GROQ_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (r.ok) {
        if (isStream) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-store",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
          });
          const reader = r.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
          res.end();
          return;
        }
        const data = await r.json();
        return json(res, 200, data);
      } else {
        const errText = await r.text().catch(() => "");
        lastStatus = r.status;
        lastErrText = errText;
        if (/does not exist|not have access|model_not_found|404|decommissioned|deprecated|discontinued|d[ée]saffect[ée]|pris en charge|unsupported/i.test(errText)) {
          console.warn(`[arvys-gateway] Modèle Groq ${m} indisponible (${errText.slice(0, 80)}), essai du repli suivant...`);
          continue;
        }
        return json(res, r.status, {
          error: { message: `Erreur Groq (${r.status}): ${errText}`, type: "api_error" },
        });
      }
    } catch (e) {
      lastErrText = e && e.message;
    }
  }

  // Si tous les modèles Groq échouent et que Workers AI est configuré, on bascule en ultime secours
  if (CREDS) {
    console.warn("[arvys-gateway] Bascule automatique sur Workers AI après échec de tous les modèles Groq...");
    try {
      const chain = CHAIN[askedModel] ? askedModel : "arvys-code";
      for (const model of CHAIN[chain]) {
        try {
          const out = await runOnce(model, messages, reqBody);
          if (out.stream) {
            return streamToClient(out.stream, askedModel, model, res);
          }
          res.setHeader("x-arvys-model", model);
          return json(res, 200, {
            id: "chatcmpl-arvys-" + Date.now().toString(36),
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: askedModel,
            choices: [
              { index: 0, message: { role: "assistant", content: out.text }, finish_reason: "stop" },
            ],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          });
        } catch (e) {}
      }
    } catch (e) {}
  }

  return json(res, lastStatus, {
    error: { message: `Erreur Groq (tous les modèles de repli ont échoué): ${lastErrText}`, type: "api_error" },
  });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/health") {
    return json(res, 200, {
      ok: true,
      service: "arvys-gateway",
      models: MODELS,
      provider: PROVIDER,
      quota: PROVIDER === "groq" ? { limit: DAILY_LIMIT, used: dailyCount, remaining: Math.max(0, DAILY_LIMIT - dailyCount) } : null,
      chain: CHAIN,
    });
  }
  if (u.pathname === "/v1/models" || u.pathname === "/models") {
    return json(res, 200, {
      object: "list",
      data: MODELS.map((m) => ({ id: m, object: "model", owned_by: "arvys" })),
    });
  }
  if ((u.pathname === "/v1/chat/completions" || u.pathname === "/chat/completions") && req.method === "POST") {
    return chatCompletions(req, res);
  }
  json(res, 404, { error: { message: "route inconnue", type: "invalid_request_error" } });
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`[arvys-gateway] :${PORT} déjà occupé — sortie silencieuse`);
    process.exit(0);
  }
  console.error(`[arvys-gateway] erreur : ${err && err.message}`);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `[arvys-gateway] OpenAI-compatible ready on 127.0.0.1:${PORT} -> ${PROVIDER}` +
      ` (arvys-code : ${CHAIN["arvys-code"][0]}) — modèles : ${MODELS.join(", ")}`
  );
});
