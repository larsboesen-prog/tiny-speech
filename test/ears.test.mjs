// The tiny ears (plan step B16): the matcher (engines/ears-match.js) on made-up sounds, San Miguel's word list, the site configs,
// and, when the model file is here (engines/ears/ears-int8-*.onnx, CC BY-SA 4.0: models/ears.md), the real thing in
// Chromium: asr-worker.js with model "tiny-ears" hears four recorded questions exactly as training/asr/probe/probe.py did.
// The matcher was also checked against probe.py on all 432 of the probe's cached sound files (144 clips, teacher and student, and
// unheard voices): the same words every time (20 Nov 2026).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildLexicon, decode } from "../engines/ears-match.js";
import { appConfig, asrModel, workerUrl } from "../core/config.js";
import { startServer } from "./harness/server.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const json = (p) => JSON.parse(readFileSync(ROOT + p, "utf8"));
const vocab = json("engines/ears/vocab.json");
const BLANK = vocab["<pad>"], V = Object.keys(vocab).length;

// Frames that say these sounds, each held `hold` frames with a blank between: the best sound at log 0, the rest far below.
function frames(sounds, hold = 2) {
  const seq = [];
  for (const s of sounds) { for (let k = 0; k < hold; k++) seq.push(vocab[s]); seq.push(BLANK); }
  const lp = new Float32Array(seq.length * V).fill(-30);
  seq.forEach((id, t) => { lp[t * V + id] = 0; });
  return { lp, n: seq.length };
}

test("San Miguel's word list: every sound is one the recognizer knows", () => {
  const lex = buildLexicon(json("packs/dist/mx-sma/ears-lexicon.json"), vocab);
  assert.equal(lex.words, 2842, "2,181 from the requests and the pack, and since 22 Nov 2026 the reader's words and everyday ones, the streets and hotels (tools/ears-lexicon.mjs)");
  assert.deepEqual(lex.missing, {}, "no word has a sound the recognizer cannot hear");
  assert.equal(V, 392);
});

test("the matcher finds the words the sounds spell, and only words of the list", () => {
  const lex = buildLexicon({ words: { hay: [{ lang: "es", phones: ["a", "j"] }], tacos: [{ lang: "es", phones: ["t", "a", "k", "o", "s"] }],
    taco: [{ lang: "es", phones: ["t", "a", "k", "o"] }] }, unigrams: { "<s>": 2, hay: 2, tacos: 2, "</s>": 2 }, bigrams: { "<s> hay": 2, "hay tacos": 2, "tacos </s>": 2 } }, vocab);
  let f = frames(["a", "j", "t", "a", "k", "o", "s"]);
  assert.equal(decode(f.lp, f.n, V, lex, BLANK), "hay tacos");
  f = frames(["t", "a", "k", "o"]);
  assert.equal(decode(f.lp, f.n, V, lex, BLANK), "taco");
  f = frames(["p", "e", "r", "o"]);  // no word of the list fits: nothing, rather than something made up
  assert.equal(decode(f.lp, f.n, V, lex, BLANK), "");
});

test("MapSMA uses the tiny ears with Whisper tiny as the other choice; CredBrief stays on Whisper", () => {
  const mapsma = json("apps/mapsma.json"), credbrief = json("apps/credbrief.json");
  assert.equal(asrModel(mapsma, "es"), "tiny-ears");
  assert.equal(asrModel(mapsma, "en"), "tiny-ears");
  assert.equal(asrModel(mapsma, "es", "whisper"), "onnx-community/whisper-tiny", "the reader's choice in Settings");
  assert.equal(asrModel(mapsma, "en", "whisper"), "onnx-community/whisper-tiny.en");
  assert.equal(asrModel(credbrief, "en"), "onnx-community/whisper-tiny.en");
  assert.equal(asrModel(credbrief, "en", "ears"), "onnx-community/whisper-tiny.en", "no word list: Whisper");
  assert.match(workerUrl(mapsma, "asr"), /&lexicon=%2Ftiny-speech%2Fpacks%2Fmx-sma%2Fears-lexicon\.json$/);
  assert.throws(() => appConfig({ asr: { engine: "ears" } }), /lexicon/, "the ears without a word list is a mistake in the config");
  assert.throws(() => appConfig({ asr: { engine: "whisper-large" } }), /asr\.engine/);
});

// The real model in the browser (needs it here, and cdn.jsdelivr.net for onnxruntime-web 1.18).
const require = createRequire(import.meta.url);
let chromium = null;
try { ({ chromium } = require("playwright")); } catch { /* not installed */ }
const model = readdirSync(ROOT + "engines/ears").filter((f) => /^ears-int8.*\.onnx$/.test(f)).sort().pop();  // the newest (the shipped one)
const skipLive = !chromium ? "Playwright is not installed" : !model ? "no ears model in engines/ears/ (training/ears/README.md)" : false;
let web, browser;
before(async () => {
  if (skipLive) return;
  web = await startServer();
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  browser = await chromium.launch(proxy ? { proxy: { server: proxy, bypass: "localhost,127.0.0.1" } } : {});
});
after(async () => { await browser?.close(); web?.server.close(); });

test("in the browser, the worker's tiny ears hear recorded questions as the probe did", { skip: skipLive, timeout: 180000 }, async () => {
  const clips = json("test/fixtures/ears/clips.json").clips;
  const url = `/tiny-speech/asr-worker.js?v=1&libs=t-ears-libs&ears=/engines/ears/${model}&lexicon=/packs/mx-sma/ears-lexicon.json`;
  const steps = [{ send: { type: "load", model: "tiny-ears" } }, { wait: "ready" }, { wait: "warm" }];
  clips.forEach((c, i) => steps.push({ send: { type: "transcribe", reqId: i + 1, model: "tiny-ears", language: "es", hint: "La Azotea", audio: { wav: `/fixtures/ears/${c.wav}` } } }, { wait: "text" }));
  steps.push({ send: { type: "load", model: "tiny-ears" } }, { wait: "ready" });  // asked again: already loaded, says so
  const page = await (await browser.newContext()).newPage();
  await page.goto(`http://localhost:${web.port}/harness/harness.html`);
  const r = await page.evaluate(([u, s]) => window.run(u, { module: true, steps: s, timeoutMs: 120000 }), [url, steps]);
  const bad = r.posted.filter((m) => m && (m.type === "__onerror" || m.type === "error"));
  assert.deepEqual(bad, [], "the worker started and loaded");
  const texts = r.posted.filter((m) => m && m.type === "text");
  assert.equal(texts.length, clips.length);
  texts.forEach((m, i) => {
    assert.equal(m.error, undefined, m.error);
    assert.equal(m.text, clips[i].probe_heard, `${clips[i].wav}: said "${clips[i].said}"`);
    assert.equal(m.engine, "tiny-ears");
  });
  const ready = r.posted.filter((m) => m && m.type === "ready");
  assert.equal(ready[0].fetched, 2, "the model and onnxruntime's engine fetched once");
  assert.deepEqual(r.caches["t-ears-libs"].map((u) => u.replace(/^http:\/\/localhost:\d+/, "")).sort(),
    [`/engines/ears/${model}`, "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort-wasm-simd.wasm"].sort(), "both kept for the next visit");
  console.log(JSON.stringify(texts.map((m) => ({ text: m.text, runMs: m.runMs, matchMs: m.matchMs }))));
});

// Names by sound (22 Nov 2026): with ?names=, the worker also says which place names fit the sounds best. A Danish voice (Piper
// da_DK talesyntese, CC0 data) says "Is Estoril open?"; the words come out "is it open", the sounds still say Estoril, well ahead.
// (The -cut copy starts at the speech, as the page cuts it: a second of digital silence before it, which no microphone gives,
// changes what the ears hear.)
test("in the browser, the worker finds a name by sound when the words miss it", { skip: skipLive, timeout: 180000 }, async () => {
  const url = `/tiny-speech/asr-worker.js?v=1&libs=t-ears-libs&ears=/engines/ears/${model}&lexicon=/packs/mx-sma/ears-lexicon-en.json&names=/packs/mx-sma/ears-names.json`;
  const steps = [{ send: { type: "load", model: "tiny-ears" } }, { wait: "ready" },
    { send: { type: "transcribe", reqId: 1, model: "tiny-ears", audio: { wav: "/fixtures/ears/acc-67-0-da_DK-talesyntese-medium-cut.wav" } } }, { wait: "text" }];
  const page = await (await browser.newContext()).newPage();
  await page.goto(`http://localhost:${web.port}/harness/harness.html`);
  const r = await page.evaluate(([u, s]) => window.run(u, { module: true, steps: s, timeoutMs: 120000 }), [url, steps]);
  const m = r.posted.find((x) => x && x.type === "text");
  assert.equal(m.error, undefined, m.error);
  assert.doesNotMatch(m.text, /estoril/, `the words miss the name: "${m.text}"`);
  assert.equal(m.spot.length, 5);
  assert.deepEqual(m.spot[0], { id: "67", name: "Estoril", perSound: m.spot[0].perSound });
  assert.ok(m.spot[0].perSound < 2.5 && m.spot[1].perSound - m.spot[0].perSound > 1, JSON.stringify(m.spot.slice(0, 2)));
  console.log(JSON.stringify({ text: m.text, spot: m.spot.slice(0, 3), spotMs: m.spotMs }));
});

// Learning from picks in the worker, on a fixed file (no microphone): the Danish voice's "Is Tacos Don Tomás open?" (heard "is text mes
// open", Tacos Don Tomás 1.4 per sound, Jacques 1.8); the visitor picks it; the same question then costs almost nothing; a new worker
// given the reading back (as the page does on the next visit) hears it the same; forget undoes it.
test("in the browser, the worker learns a picked name, takes it back next visit, and forgets it", { skip: skipLive, timeout: 180000 }, async () => {
  const url = `/tiny-speech/asr-worker.js?v=1&libs=t-ears-libs&ears=/engines/ears/${model}&lexicon=/packs/mx-sma/ears-lexicon-en.json&names=/packs/mx-sma/ears-names.json`;
  const wav = { wav: "/fixtures/ears/acc-22-0-da_DK-talesyntese-medium-cut.wav" };
  const hear = (reqId) => [{ send: { type: "transcribe", reqId, model: "tiny-ears", audio: wav } }, { wait: "text" }];
  const page = await (await browser.newContext()).newPage();
  await page.goto(`http://localhost:${web.port}/harness/harness.html`);
  const run = (steps) => page.evaluate(([u, s]) => window.run(u, { module: true, steps: s, timeoutMs: 120000 }), [url, steps]);
  const a = await run([{ send: { type: "load", model: "tiny-ears" } }, { wait: "ready" }, ...hear(1), { send: { type: "learn", heardId: "last", id: "22" } }, { wait: "learned" }, ...hear(2),
    { send: { type: "forget" } }, ...hear(3)]);
  const texts = a.posted.filter((m) => m && m.type === "text"), learned = a.posted.find((m) => m && m.type === "learned");
  const cost = (m) => m.spot.find((x) => x.id === "22").perSound;
  console.log(JSON.stringify({ text: texts[0].text, before: cost(texts[0]), learned: learned.phones.join(" "), after: cost(texts[1]), forgotten: cost(texts[2]) }));
  assert.ok(learned.phones && learned.phones.length >= 3);
  assert.ok(cost(texts[0]) > 1, "before: not clear");
  assert.equal(texts[1].spot[0].id, "22");
  assert.ok(cost(texts[1]) < 0.3, "after the pick: clear");
  assert.ok(Math.abs(cost(texts[2]) - cost(texts[0])) < 1e-6, "forgotten: as before");
  // the next visit: a new worker given the reading back
  const b = await run([{ send: { type: "readings", readings: [{ id: "22", phones: learned.phones }] } }, { send: { type: "load", model: "tiny-ears" } }, { wait: "ready" }, ...hear(1)]);
  const t = b.posted.find((m) => m && m.type === "text");
  assert.equal(t.spot[0].id, "22");
  assert.ok(cost(t) < 0.3, `taken back: ${cost(t)}`);
});
