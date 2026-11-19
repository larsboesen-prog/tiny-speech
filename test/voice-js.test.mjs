// tiny-voca in plain JavaScript (plan step B10), with the real model file: the engine in Node, and the worker in Chromium with the
// same messages as the ONNX worker. Skipped when the model is not here: run `npm run fetch:voice` first (7,988,384 bytes).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createVoice, MODEL } from "../engines/tinyvoca-js.js";
import { startServer } from "./harness/server.mjs";
import { loadCore } from "./golden/mapsma.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const GGUF = fileURLToPath(new URL("../vendor/tiny-voca/tiny-voca-js.gguf", import.meta.url));
const haveModel = existsSync(GGUF);
const require = createRequire(import.meta.url);
let chromium = null;
try { ({ chromium } = require("playwright")); } catch { /* not installed */ }
const skip = !haveModel ? "no model file: npm run fetch:voice" : false;
const skipBrowser = skip || (chromium ? false : "Playwright is not installed");

const { pack } = await loadCore();
const city = { english: pack.lexicon.english, readings: pack.lexicon.readings, names: pack.places.map((p) => p.name) };
let voice = null, web = null, browser = null;
before(async () => {
  if (!skip) voice = await createVoice(new Uint8Array(readFileSync(GGUF)).buffer, { spanish: city });
  if (!skipBrowser) { web = await startServer(); browser = await chromium.launch(); }
});
after(async () => { await browser?.close(); web?.server.close(); });

test("English and Spanish sentences become clean audio", { skip }, () => {
  for (const [text, lang] of [["Find three restaurants in Centro that are open now.", "en"], ["¿Qué restaurantes están abiertos esta noche?", "es"]]) {
    const out = voice.speak(text, { lang, voice: "M2", pitch: -0.3 });
    const samples = out.reduce((n, o) => n + o.audio.length, 0);
    assert.ok(samples / voice.sampleRate > 1.5 && samples / voice.sampleRate < 8, `${text}: ${samples / voice.sampleRate} s`);
    for (const o of out) {
      const peak = o.audio.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
      assert.ok(peak <= 0.7001 && peak > 0.1, `peak ${peak}`);
      assert.ok(Math.abs(o.audio[0]) < 1e-3 && Math.abs(o.audio.at(-1)) < 1e-3, "faded in and out");
    }
  }
});

test("Spanish is read with Spanish sounds; a taught name changes English too", { skip }, () => {
  assert.match(voice.phones("La Azotea está abierta.", "es"), /ɑː s oʊ t ˈeɪ ɑː/);
  assert.doesNotMatch(voice.phones("La Azotea is open.", "en"), /ɑː s oʊ t ˈeɪ ɑː/, "not taught yet: an English guess");
  assert.equal(voice.teach({ azotea: "ɑː s oʊ t ˈeɪ ɑː", bad: "q q q" }), 1, "a reading it refuses is skipped");
  assert.match(voice.phones("La Azotea is open.", "en"), /ɑː s oʊ t ˈeɪ ɑː/);
  assert.match(voice.phones("Don Taco Tequila, a unos 350 metros.", "es"), /t ə k ˈiː l ə .* t ɾ eɪ s j ˈɛ n t oʊ s/, "English inside the name, numbers in Spanish");
});

test("a sentence too long for the model is split, not dropped", { skip }, () => {
  const long = Array.from({ length: 12 }, (_, i) => `el lugar número ${i + 1} abre a las nueve y media de la mañana`).join(", ") + ".";
  const parts = voice.utterances(long, "es");
  assert.ok(parts.length > 1 && parts.every((u) => u.ids.length <= voice.limit + 12));
});

async function worker(context, steps, url = "/tiny-speech/tinyvoca-js-worker.js?v=1&site=test&model=/vendor/tiny-voca/tiny-voca-js.gguf") {
  const page = await context.newPage();
  await page.goto(`http://localhost:${web.port}/harness/harness.html`);
  const r = await page.evaluate(([u, s]) => window.run(u, { module: true, steps: s, timeoutMs: 60000 }), [url, steps]);
  await page.close();
  return r;
}

test("the worker speaks as the ONNX worker does: load, teach, stream, Spanish, stop", { skip: skipBrowser }, async () => {
  const context = await browser.newContext();
  const r = await worker(context, [
    { send: { type: "teach", words: { azotea: "ɑː s oʊ t ˈeɪ ɑː" } } },
    { send: { type: "load" } }, { wait: "ready" },
    { send: { type: "phones", id: 1, text: "Is La Azotea open?" } }, { wait: "phones" },
    { send: { type: "speak", id: 2, sentences: ["La Azotea is open until ten."], base: 3, voice: 1, speed: 1, pitch: -0.3, open: true } }, { wait: "sentence" },
    { send: { type: "more", id: 2, sentences: ["Bocaciega closes at eleven."], last: true } }, { wait: "done" },
    { send: { type: "speak", id: 3, text: "Sí. La Azotea está abierta hasta la medianoche.", voice: 1, lang: "es" } }, { wait: "done" },
  ]);
  const types = r.posted.map((m) => m.type);
  assert.ok(!types.includes("error") && !types.includes("__onerror"), JSON.stringify(r.posted.filter((m) => /error/.test(m.type))));
  const ready = r.posted.find((m) => m.type === "ready");
  assert.deepEqual([ready.core, ready.voices, ready.sampleRate, ready.fetched], ["tiny-speech 0.3.0", ["F2", "M2"], 24000, 1]);
  assert.equal(r.posted.find((m) => m.type === "taught").words, 1);
  assert.match(r.posted.find((m) => m.type === "phones").text, /ɑː s oʊ t ˈeɪ ɑː/);
  const sentences = r.posted.filter((m) => m.type === "sentence");
  assert.deepEqual(sentences.filter((m) => m.id === 2).map((m) => [m.index, m.total]), [[3, 4], [4, 5]]);
  assert.ok(sentences.filter((m) => m.id === 3).length === 2 && sentences.every((m) => m.audio.float32 > 10000));
  assert.ok(Object.keys(r.caches).some((n) => n.startsWith("tiny-speech-tinyvoca-js-1e73262")), "kept on the device");
  const again = await worker(context, [{ send: { type: "load" } }, { wait: "ready" }]);
  assert.deepEqual([again.posted.find((m) => m.type === "ready").kept, again.posted.find((m) => m.type === "ready").fetched], [1, 0]);
  await context.close();
});

test("the worker refuses a model file that does not match its SHA-256", { skip: skipBrowser }, async () => {
  // (served changed by the test server: in this Chromium a Playwright route stops module workers with nested imports from starting)
  const context = await browser.newContext();
  const r = await worker(context, [{ send: { type: "load" } }, { wait: "error" }], "/tiny-speech/tinyvoca-js-worker.js?v=1&site=test&model=/corrupt/tiny-voca-js.gguf");
  assert.match(r.posted.find((m) => m.type === "error").message, /does not match its SHA-256/);
  assert.equal(MODEL.bytes, readFileSync(GGUF).length);
  await context.close();
});

test("the bilingual voice file loads by ?model= and ?sha256=, and reads Spanish after <es>", { skip: skipBrowser || (existsSync(ROOT + "vendor/tiny-voca/tiny-voca-bilingual-init.gguf") ? false : "no bilingual file (node tools/voice-gguf.mjs init)") }, async () => {
  const file = ROOT + "vendor/tiny-voca/tiny-voca-bilingual-init.gguf";
  const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
  const context = await browser.newContext();
  const r = await worker(context, [
    { send: { type: "load" } }, { wait: "ready" },
    { send: { type: "phones", id: 1, text: "Mama Mía tiene salsa esta noche.", lang: "es" } }, { wait: "phones" },
    { send: { type: "speak", id: 2, text: "Mama Mía tiene salsa esta noche.", lang: "es" } }, { wait: "done" },
  ], `/tiny-speech/tinyvoca-js-worker.js?v=1&cache=t-bi-&model=/vendor/tiny-voca/tiny-voca-bilingual-init.gguf&sha256=${sha}`);
  assert.ok(!r.posted.some((m) => /error/.test(m.type)), JSON.stringify(r.posted.filter((m) => /error/.test(m.type))));
  assert.deepEqual(r.posted.find((m) => m.type === "ready").voices, ["F2", "M2", "MX1"]);
  assert.match(r.posted.find((m) => m.type === "phones").text, /^<es> m ˈa m a <sp> m ˈi a/);
  assert.ok(r.posted.filter((m) => m.type === "sentence").every((m) => m.audio.float32 > 10000));
  assert.ok(Object.keys(r.caches).some((n) => n.startsWith("t-bi-" + sha.slice(0, 7))), "kept under its own hash");
  await context.close();
});
