// OpenRouter for build-time teaching only (never at run time, never on a visitor's phone): a large model writes data, which is
// checked by rules and committed as data. Every call's cost goes to training/costs.jsonl; no call is made once the key's usage
// reaches BUDGET (the owner's key is also capped at $15 on OpenRouter's side). The key is added by this environment's proxy;
// nothing here holds it. Run with NODE_USE_ENV_PROXY=1 (Node's fetch then uses the proxy).
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const API = "https://openrouter.ai/api/v1";
export const BUDGET = Number(process.env.TS_BUDGET || 14);
const LOG = fileURLToPath(new URL("../training/costs.jsonl", import.meta.url));
mkdirSync(fileURLToPath(new URL("../training/", import.meta.url)), { recursive: true });

export async function usage() {
  const r = await fetch(`${API}/key`);
  if (!r.ok) throw new Error(`openrouter key: ${r.status}`);
  const d = (await r.json()).data;
  return { used: d.usage, limit: d.limit, left: d.limit_remaining };
}

const FENCE = /^\s*`{3}(?:json)?\s*|\s*`{3}\s*$/g;

/** One chat call; returns {text, json, cost}. With `json`, asks for a JSON object and parses it (null if it is not JSON). */
/** Dollars spent so far by this repository's calls (OpenRouter's own figure for the key lags by minutes). */
export function spent() {
  try { return readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).reduce((s, l) => s + (JSON.parse(l).cost || 0), 0); } catch { return 0; }
}

export async function chat({ model, system, user, json = true, maxTokens = 8000, temperature = 0.9, purpose = "" }) {
  const { used } = await usage();
  const mine = spent();
  if (Math.max(used, mine) >= BUDGET) throw new Error(`budget reached: $${Math.max(used, mine).toFixed(2)} of $${BUDGET} used`);
  const body = {
    model, max_tokens: maxTokens, temperature, usage: { include: true },
    messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: user }],
    ...(json ? { response_format: { type: "json_object" } } : {}),
  };
  let r = null, d = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    r = await fetch(`${API}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", "X-Title": "tiny-speech" }, body: JSON.stringify(body) });
    d = await r.json().catch(() => ({}));
    if (r.ok && d.choices) break;
    await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
  }
  if (!r.ok || !d.choices) throw new Error(`openrouter ${model}: ${r.status} ${JSON.stringify(d.error || d).slice(0, 300)}`);
  const text = d.choices[0].message.content || "";
  const cost = d.usage?.cost ?? null;
  appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), model, purpose, prompt: d.usage?.prompt_tokens, completion: d.usage?.completion_tokens, cost }) + "\n");
  let parsed = null;
  if (json) { try { parsed = JSON.parse(text.replace(FENCE, "")); } catch { parsed = null; } }
  return { text, json: parsed, cost };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(await usage());
