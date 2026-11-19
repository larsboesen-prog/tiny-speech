// Shared core v0 must change nothing for either site. Each test runs a site's original worker (as served on 18 Nov 2026, kept in
// test/fixtures/before/) and the shared one through the same messages, in a fresh browser profile, with stand-in libraries
// (harness/fakes.mjs), and compares: every message posted back, every call into the libraries, and the Cache Storage it leaves
// (names and keys: what a visitor keeps between visits). Run: npm test   (needs Playwright's Chromium)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startServer } from "./harness/server.mjs";
import { installFakes } from "./harness/fakes.mjs";

const require = createRequire(import.meta.url);
let chromium = null;
try { ({ chromium } = require("playwright")); } catch { /* not installed: the tests are skipped */ }
const skip = chromium ? false : "Playwright is not installed";

const CORE = "tiny-speech 0.1.0";
const TIMING = new Set(["ms", "waitMs", "runMs", "totalTime", "parts"]);

let web, browser;
before(async () => {
  if (skip) return;
  web = await startServer();
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  web?.server.close();
});

// One worker run in its own profile (or in `context`, to share storage with an earlier run).
async function runWorker(url, options, context = null) {
  const own = !context;
  context ||= await browser.newContext();
  const hits = {};
  await installFakes(context, hits);
  const page = await context.newPage();
  await page.goto(`http://localhost:${web.port}/harness/harness.html`);
  const result = await page.evaluate(([u, o]) => window.run(u, o), [url, options]);
  await page.close();
  if (own) await context.close();
  return { ...result, network: hits };
}

// Messages without timings; the shared worker's "ready" also says its version, which is checked and then left out.
// While loading, the voice worker fetches its files and starts its phonemizer and its model at the same time (Promise.all), so
// what it posts before the first "ready" interleaves by network timing, in the original as much as in the shared worker: that
// part is compared as a set. Everything from "ready" on (the questions, the sentences, their order) is compared in order.
function comparable(result, shared) {
  const posted = result.posted.map((m) => {
    if (!m || typeof m !== "object") return m;
    const out = {};
    for (const [k, v] of Object.entries(m)) if (!TIMING.has(k) && !(k === "core" && m.type === "ready")) out[k] = v;
    if (m.type === "ready" && shared) assert.equal(m.core, CORE, "the shared worker's ready message names its version");
    return out;
  });
  const ready = posted.findIndex((m) => m && m.type === "ready");
  const split = ready < 0 ? posted.length : ready;
  return {
    loading: posted.slice(0, split).map((m) => JSON.stringify(m)).sort(),
    afterReady: posted.slice(split),
    caches: result.caches,
  };
}

async function same(original, shared, options) {
  const a = await runWorker(original, options);
  const b = await runWorker(shared, options);
  const errors = [...a.posted, ...b.posted].filter((m) => m && m.type === "__onerror");
  assert.deepEqual(errors, [], "no worker failed to start");
  assert.deepEqual(comparable(b, true), comparable(a, false));
  assert.deepEqual(b.network, a.network, "the same files are fetched from the network");
  return { original: a, shared: b };
}

const HINT = "La Azotea, Bocaciega, Tostévere, Café Umarán, Centro, Jardín";

const ASR_PAGE40 = [
  { send: { type: "load", model: "onnx-community/whisper-tiny.en" } }, { wait: "ready" }, { wait: "warm" },
  { send: { type: "transcribe", reqId: 1, model: "onnx-community/whisper-tiny.en", audio: { samples: 48000 } } }, { wait: "text" },
  { send: { type: "load", model: "onnx-community/whisper-tiny.en" } }, { wait: "ready" },
  { send: { type: "transcribe", reqId: 2, model: "onnx-community/moonshine-tiny-ONNX", audio: { samples: 57600 } } }, { wait: "text" },
  { sleep: 80 },
  { send: { type: "transcribe", reqId: 3, model: "fail/model", audio: { samples: 16000 } } }, { wait: "text" },
];

const ASR_PAGE5 = [
  { send: { type: "load", model: "onnx-community/whisper-tiny" } }, { wait: "ready" }, { wait: "warm" },
  { send: { type: "transcribe", reqId: 1, model: "onnx-community/whisper-tiny", language: "es", hint: HINT, audio: { samples: 32000 } } }, { wait: "text" },
  { send: { type: "transcribe", reqId: 2, model: "onnx-community/whisper-tiny", language: "es", audio: { samples: 16000 } } }, { wait: "text" },
  { send: { type: "transcribe", reqId: 3, model: "onnx-community/whisper-tiny", language: "es", hint: HINT, audio: { samples: 24000 } } }, { wait: "text" },
  { send: { type: "transcribe", reqId: 4, model: "onnx-community/whisper-tiny.en", hint: HINT, audio: { samples: 16000 } } }, { wait: "text" },
];

const VOICE_PAGE40 = [
  { send: { type: "load" } }, { wait: "ready" },
  { send: { type: "speak", id: 1, sentences: ["Hello there.", "The second sentence is a little longer than the first one"], base: 0, voice: 1, speed: 1, pitch: -0.3, open: true } },
  { wait: "sentence", n: 2 },
  { send: { type: "more", id: 1, sentences: ["Third."], last: true } }, { wait: "done" },
  { send: { type: "speak", id: 2, text: "Mr. Smith went home. It was late", voice: 1, speed: 1.1 } }, { wait: "done" },
  { send: { type: "speak", id: 3, text: "!!!", voice: 1, speed: 1 } }, { wait: "error" },
  { send: { type: "stop" } }, { sleep: 40 },
];

const VOICE_PAGE5 = [
  { send: { type: "teach", words: { azotea: "ɑː s oʊ t ˈeɪ ɑː", bocaciega: "b oʊ k ɑː s j ˈeɪ ɡ ɑː" } } },
  { send: { type: "load" } }, { wait: "ready" },
  { send: { type: "phones", id: 7, text: "La Azotea" } }, { wait: "phones" },
  { send: { type: "speak", id: 1, sentences: ["La Azotea is open until ten."], base: 3, voice: 1, speed: 1, pitch: -0.3 } }, { wait: "done" },
  { send: { type: "teach", words: { umaran: "uː m ɑː ɾ ˈɑː n" } } }, { wait: "taught" },
];

test("speech to text: CredBrief /page40 gets exactly what it got before", { skip }, async () => {
  const { shared } = await same("/page40/asr-worker.js?v=1", "/tiny-speech/asr-worker.js?v=1&site=credbrief", { module: true, steps: ASR_PAGE40 });
  const texts = shared.posted.filter((m) => m.type === "text");
  assert.equal(texts.length, 3);
  assert.ok(texts[2].error, "a model that cannot load gives an error, as before");
});

test("speech to text: MapSMA /page5 keeps the name hint and the Spanish language", { skip }, async () => {
  const { shared } = await same("/page5/asr-worker.js?v=1", "/tiny-speech/asr-worker.js?v=1&site=mapsma", { module: true, steps: ASR_PAGE5 });
  const texts = shared.posted.filter((m) => m.type === "text").map((m) => m.text);
  assert.deepEqual(texts, ["what is open tonight 32000", "what is open tonight 16000", "what is open tonight 24000", "what is open tonight 16000"],
    "the names Whisper writes back are cut off");
  const runs = shared.posted.filter((m) => m.type === "__fake" && m.entry[0] === "run").map((m) => m.entry[3]);
  assert.ok(runs[1].decoder_input_ids.includes(4), "with the names, Spanish is still asked for (<|es|>)");
  assert.equal(runs[2].language, "es", "without the names, the language is passed as before");
});

test("voice: CredBrief /page40 gets exactly what it got before", { skip }, async () => {
  const { shared } = await same("/page40/tinyvoca-worker.js?v=1", "/tiny-speech/tinyvoca-worker.js?v=1&site=credbrief&dizione=/page40/tinyvoca/dizione.zip",
    { steps: VOICE_PAGE40 });
  assert.ok(shared.posted.filter((m) => m.type === "sentence").length >= 4);
});

test("voice: MapSMA /page5 keeps teaching the Spanish names", { skip }, async () => {
  const { shared } = await same("/page5/tinyvoca-worker.js?v=1", "/tiny-speech/tinyvoca-worker.js?v=1&site=mapsma&dizione=/page5/tinyvoca/dizione.zip",
    { steps: VOICE_PAGE5 });
  assert.deepEqual(shared.posted.filter((m) => m.type === "taught").map((m) => m.words), [2, 1]);
  assert.equal(shared.posted.find((m) => m.type === "phones").text, "ph(La Azotea)");
});

// A visitor who used a page before the switch: the shared worker finds everything the old one stored, so the second visit
// fetches the same files as a second visit always did (only tiny-voca's config.json, which was never stored).
for (const [site, page] of [["mapsma", "page5"], ["credbrief", "page40"]]) {
  test(`switching ${site} to the shared core downloads nothing again`, { skip }, async () => {
    const visit = async (secondUrl) => {
      const context = await browser.newContext();
      await runWorker(`/${page}/tinyvoca-worker.js?v=1`, { steps: [{ send: { type: "load" } }, { wait: "ready" }] }, context);
      await runWorker(`/${page}/asr-worker.js?v=1`, { module: true, steps: [{ send: { type: "load", model: "onnx-community/whisper-tiny.en" } }, { wait: "ready" }] }, context);
      const before = { ...web.hits };
      const voice = await runWorker(secondUrl.voice, { steps: [{ send: { type: "load" } }, { wait: "ready" }] }, context);
      const asr = await runWorker(secondUrl.asr, { module: true, steps: [{ send: { type: "load", model: "onnx-community/whisper-tiny.en" } }, { wait: "ready" }] }, context);
      const zip = (web.hits[`/${page}/tinyvoca/dizione.zip`] || 0) - (before[`/${page}/tinyvoca/dizione.zip`] || 0);
      await context.close();
      const ready = (r) => r.posted.find((m) => m.type === "ready");
      return { voiceNet: voice.network, asrNet: asr.network, zip, voiceSeen: [ready(voice).kept, ready(voice).fetched], asrSeen: [ready(asr).kept, ready(asr).fetched] };
    };
    const asBefore = await visit({ voice: `/${page}/tinyvoca-worker.js?v=2`, asr: `/${page}/asr-worker.js?v=2` });
    const shared = await visit({
      voice: `/tiny-speech/tinyvoca-worker.js?v=2&site=${site}&dizione=/${page}/tinyvoca/dizione.zip`,
      asr: `/tiny-speech/asr-worker.js?v=2&site=${site}`,
    });
    assert.deepEqual(shared, asBefore);
    assert.equal(shared.zip, 0, "dizione.zip comes from this device");
    assert.deepEqual(Object.keys(shared.voiceNet).filter((u) => !/\.js$/.test(u)), [`https://huggingface.co/n4ze3m/tiny-voca/resolve/d94d2a0338fd1e0eab7dd896ec0ad23d8cdf7c14/config.json`]);
    assert.equal(shared.voiceSeen[1], 0, "the voice worker fetched none of the files it keeps");
  });
}

// Without ?site=, the host name decides; anywhere else the caches get names of their own.
test("without ?site=, the host name picks the site's cache names", { skip }, async () => {
  const hosts = ["mapsma.com", "credbrief.com"];
  const own = await chromium.launch({
    channel: "chromium",  // full Chromium: the headless shell ignores the flag that makes these origins secure (Cache Storage)
    args: [`--host-resolver-rules=${hosts.map((h) => `MAP ${h} 127.0.0.1`).join(", ")}`,
      `--unsafely-treat-insecure-origin-as-secure=${hosts.map((h) => `http://${h}:${web.port}`).join(",")}`],
  });
  const names = {};
  try {
    for (const origin of [...hosts.map((h) => `http://${h}:${web.port}`), `http://localhost:${web.port}`]) {
      const context = await own.newContext();
      await installFakes(context, {});
      const page = await context.newPage();
      await page.goto(`${origin}/harness/harness.html`);
      const result = await page.evaluate(() => window.run("/tiny-speech/tinyvoca-worker.js?v=1&dizione=/page5/tinyvoca/dizione.zip",
        { steps: [{ send: { type: "load" } }, { wait: "ready" }] }));
      names[new URL(origin).hostname] = Object.keys(result.caches);
      await context.close();
    }
  } finally {
    await own.close();
  }
  assert.deepEqual(names, {
    "mapsma.com": ["mapsma-tinyvoca-d94d2a0-8cd889e", "mapsma-voice-libs-1"],
    "credbrief.com": ["credbrief-page40-libs-1", "credbrief-tinyvoca-d94d2a0-8cd889e"],
    localhost: ["tiny-speech-libs-1", "tiny-speech-tinyvoca-d94d2a0-8cd889e"],
  });
});
