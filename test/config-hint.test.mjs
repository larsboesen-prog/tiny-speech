// Plan step B9: a site's config instead of the workers' table of sites; the recognizer's name hint built from a city pack within
// Whisper's token budget; one result shape for speech to text. The browser half (the workers reading their addresses, the hint
// packed by the worker, the AsrEngine) runs in Chromium with the stand-in libraries.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { appConfig, appForHost, workerUrl, limitsOf, DEFAULTS } from "../core/config.js";
import { hintNames, fitHint, estimateTokens } from "../core/pack/hint.js";
import { createBpe } from "../engines/whisper-tokens.js";
import { tokenizerPath } from "../tools/hint-report.mjs";
import { loadCore } from "./golden/mapsma.mjs";
import { startServer } from "./harness/server.mjs";
import { installFakes } from "./harness/fakes.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const app = (a) => JSON.parse(readFileSync(ROOT + `apps/${a}.json`, "utf8"));
const index = JSON.parse(readFileSync(ROOT + "apps/index.json", "utf8"));

test("each site's config gives the cache names its page used before the shared core", () => {
  assert.equal(workerUrl(app("mapsma"), "asr"), "asr-worker.js?libs=mapsma-voice-libs-1&ears=%2Ftiny-speech%2Fengines%2Fears%2Fears-int8-2026-11-20.onnx&lexicon=%2Ftiny-speech%2Fpacks%2Fmx-sma%2Fears-lexicon.json",
    "MapSMA's cache name as before, and where the tiny ears' files are (plan step B16)");
  assert.equal(workerUrl(app("credbrief"), "asr"), "asr-worker.js?libs=credbrief-page40-libs-1", "CredBrief stays on Whisper");
  assert.equal(workerUrl(app("credbrief"), "voice", { v: "3" }), "tinyvoca-worker.js?v=3&libs=credbrief-page40-libs-1&voice=credbrief-tinyvoca-&dizione=%2Fpage40%2Ftinyvoca%2Fdizione.zip");
  assert.equal(workerUrl({}, "asr"), "asr-worker.js?libs=tiny-speech-libs-1", "no config: names of its own");
  assert.equal(workerUrl(app("mapsma"), "voiceJs"), "tinyvoca-js-worker.js?cache=mapsma-tinyvoca-js-");
  assert.equal(workerUrl(app("mapsma"), "voiceJs", { model: "/v/bi.gguf", sha256: "ab12" }), "tinyvoca-js-worker.js?cache=mapsma-tinyvoca-js-&model=%2Fv%2Fbi.gguf&sha256=ab12");
  for (const a of index.apps) assert.deepEqual(appConfig(app(a.app)).hosts, a.hosts, `${a.app}: the index and the config agree`);
  assert.equal(appForHost(index, "www.mapsma.com").app, "mapsma");
  assert.equal(appForHost(index, "credbrief.com").app, "credbrief");
  assert.equal(appForHost(index, "example.org"), null);
});

test("limits come from the config, over listen.js's defaults; a bad config is refused", () => {
  assert.equal(limitsOf(app("mapsma")).REC_MAX_MS, 8000);
  assert.equal(limitsOf(app("credbrief")).REC_MAX_MS, 5000);
  assert.equal(limitsOf(app("mapsma")).END_SILENCE_MS, DEFAULTS.limits.endSilenceMs);
  assert.throws(() => appConfig({ caches: { libs: "Bad Name!" } }), /caches\.libs/);
  assert.throws(() => appConfig({ asr: { hintBudget: 400 } }), /hintBudget 400/);
});

// Whisper's own tokenizers (fetched by tools/hint-report.mjs into its cache); the exact checks are skipped without them.
const tok = (model) => (existsSync(tokenizerPath(model)) ? createBpe(JSON.parse(readFileSync(tokenizerPath(model), "utf8"))) : null);
const en = tok("onnx-community/whisper-tiny.en"), es = tok("onnx-community/whisper-tiny");
const noTokenizer = en && es ? false : "Whisper's tokenizers are not in the cache (node tools/hint-report.mjs fetches them)";

test("the tokenizer counts /page5's hint as /page5 measured it: 214 tokens", { skip: noTokenizer }, () => {
  const places = JSON.parse(readFileSync(ROOT + "test/fixtures/before/mx-sma-pack/places.json", "utf8"));
  const picks = places.filter((p) => p.kind !== "sights" && !p.other && p.photo && !p.hint?.skip).map((p) => p.hint?.as || p.name);
  const hint = `Centro, Jardín, Susan York, ${picks.join(", ")}.`;
  assert.equal(en.count(" " + hint), 214, "whisper-tiny.en (17 Nov 2026: 214)");
  assert.deepEqual(en.encode(" Hello world"), [18435, 995]);
});

test("San Miguel's hint: /page5's names first, as many more as fit in 220 tokens, the rest reported", { skip: noTokenizer }, async () => {
  const { pack } = await loadCore();
  const places = JSON.parse(readFileSync(ROOT + "test/fixtures/before/mx-sma-pack/places.json", "utf8"));
  const page5 = ["Centro", "Jardín", "Susan York", ...places.filter((p) => p.kind !== "sights" && !p.other && p.photo && !p.hint?.skip).map((p) => p.hint?.as || p.name)];
  for (const [lang, bpe] of [["en", en], ["es", es]]) {
    const h = fitHint(hintNames(pack, lang), 220, bpe.count);
    assert.ok(h.tokens <= 220, `${lang}: ${h.tokens} tokens`);
    assert.deepEqual(h.used.slice(0, page5.length).map((x) => x.name), page5, `${lang}: every name /page5 sent, in its order`);
    assert.ok(h.left.length > 30, `${lang}: the names that did not fit are listed (${h.left.length})`);
    assert.ok(h.left.some((x) => x.name === "Mama Mía"), "the music venues added since are found by sound matching instead");
  }
  // the estimate, for a page without the tokenizer, is close to the real count for the whole hint
  const h = fitHint(hintNames(pack, "en"), 220, en.count);
  const ratio = estimateTokens(" " + h.text) / h.tokens;
  assert.ok(ratio > 0.9 && ratio < 1.15, `estimate / real = ${ratio.toFixed(2)}`);
});

test("hint names: skipped names out, short forms used, nothing twice, a budget of 0 sends nothing", async () => {
  const { pack } = await loadCore();
  const names = hintNames(pack, "en").map((x) => x.name);
  assert.ok(!names.includes("Don Taco Tequila"), "hint.skip: heard right without help");
  assert.ok(names.includes("K'ibok") && names.includes("Garambullo"), "hint.as: the unusual part of a long name");
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length);
  assert.deepEqual(fitHint(names, 0), { text: "", tokens: 0, used: [], left: names.map((name) => ({ name })) });
});

// ---------- in the browser ----------
const require = createRequire(import.meta.url);
let chromium = null;
try { ({ chromium } = require("playwright")); } catch { /* not installed: skipped */ }
const skip = chromium ? false : "Playwright is not installed";
let web, browser;
before(async () => { if (skip) return; web = await startServer(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); web?.server.close(); });

test("the speech worker packs hintNames into the budget with the model's tokenizer, and cuts them off the answer", { skip }, async () => {
  const context = await browser.newContext();
  await installFakes(context, {});
  const page = await context.newPage();
  await page.goto(`http://localhost:${web.port}/harness/harness.html`);
  const names = ["Centro", "Jardín", "La Azotea", "A name far too long to fit in what is left of the budget", "Bocaciega"];
  const r = await page.evaluate(([n]) => window.run("/tiny-speech/asr-worker.js?v=1&libs=t-libs", { module: true, steps: [
    { send: { type: "transcribe", reqId: 1, model: "onnx-community/whisper-tiny", language: "es", hintNames: n, hintBudget: 50, audio: { samples: 16000 } } }, { wait: "text" },
  ] }), [names]);
  await context.close();
  const run = r.posted.filter((m) => m.type === "__fake" && m.entry[0] === "run").at(-1).entry[3];  // the first run is the warm-up
  const said = String.fromCodePoint(...run.decoder_input_ids.filter((i) => i >= 1000).map((i) => i - 1000));  // the stand-in: a token a letter
  assert.equal(said, " Centro, Jardín, La Azotea, Bocaciega.", "the long name is left out, the one after it still fits");
  assert.equal(r.posted.find((m) => m.type === "text").text, "what is open tonight 16000");
  assert.deepEqual(Object.keys(r.caches), ["t-libs"], "the cache name from the address");
});

test("AsrEngine: one result shape, the site's model and hint budget", { skip }, async () => {
  const context = await browser.newContext();
  await installFakes(context, {});
  const page = await context.newPage();
  await page.goto(`http://localhost:${web.port}/harness/harness.html`);
  const out = await page.evaluate(async ([config]) => {
    const { createAsrEngine } = await import("/engines/asr-whisper.js");
    const asr = createAsrEngine(config, { base: "/tiny-speech/", v: "1" });
    const tone = (n) => Float32Array.from({ length: n }, (_, i) => 0.1 * Math.sin(i / 10));
    const a = await asr.transcribe(tone(16000), { lang: "es", hintNames: [{ name: "Centro" }, { name: "Jardín" }] });
    const b = await asr.transcribe(tone(32000), { lang: "en" });
    asr.close();
    return [a, b];
  }, [app("mapsma")]);
  await context.close();
  for (const r of out) assert.deepEqual(Object.keys(r).sort(), ["alternatives", "engine", "lang", "langScores", "ms", "runMs", "text", "waitMs"]);
  assert.deepEqual([out[0].engine, out[0].lang, out[0].langScores, out[0].text], ["onnx-community/whisper-tiny", "es", null, "what is open tonight 16000"]);
  assert.deepEqual([out[1].engine, out[1].lang], ["onnx-community/whisper-tiny.en", "en"]);
});
