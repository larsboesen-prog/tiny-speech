// Plan step B13: with the site's own copies of the engine files (config "engines", here the stand-ins under /mirror/), the check
// page loads both workers, speaks, listens and answers, and no request leaves the page's origin or carries the recording.
// Chromium runs with the test server as its proxy: a request for any other host reaches the server as a proxy request (even from
// a worker, which Playwright's routes do not see reliably) and is refused and listed in `leaks`. Every request's body is counted.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startServer } from "./harness/server.mjs";
import { engines, coreFiles, manifest } from "../tools/manifest.mjs";

test("the manifest lists every engine file the four engines fetch, with size and SHA-256", () => {
  const { files, recorded } = engines();
  assert.match(recorded, /^\d{4}-\d{2}-\d{2}$/);
  for (const f of files) {
    assert.match(f.url, /^https:\/\/(cdn\.jsdelivr\.net|huggingface\.co)\//, f.url);
    assert.equal(f.path, f.url.slice("https://".length).replace(/(@\d[\w.-]*)$/, "$1/index.js"));
    assert.ok(f.bytes > 0 && /^[0-9a-f]{64}$/.test(f.sha256), f.url);
  }
  for (const role of ["asr-en", "asr-es", "voice", "voiceJs"]) assert.ok(files.some((f) => f.for.includes(role)), role);
  const gguf = files.find((f) => f.url.endsWith("/gguf/tiny-voca-js.gguf"));
  assert.deepEqual([gguf.bytes, gguf.sha256], [7988384, "8436ad1c9b57c3533c925588a1b3563f906079a89c081ac0bec9f31ad6e28653"], "the plain-JS voice, as the engine pins it");
  const core = coreFiles();
  for (const f of ["browser/asr-worker.js", "browser/tinyvoca-worker.js", "browser/listen.js", "core/config.js", "apps/mapsma.json"]) assert.ok(core[f]?.sha256, f);
  assert.equal(manifest().engines.length, files.length);
});

const require = createRequire(import.meta.url);
let chromium = null;
try { ({ chromium } = require("playwright")); } catch { /* not installed: skipped */ }
const skip = chromium ? false : "Playwright is not installed";

let web, browser;
before(async () => {
  if (skip) return;
  web = await startServer();
  // every request for another host goes to the test server as a proxy; localhost itself is never proxied
  browser = await chromium.launch({ proxy: { server: `http://127.0.0.1:${web.port}`, bypass: "localhost,127.0.0.1" } });
});
after(async () => { await browser?.close(); web?.server.close(); });

async function checkPage(query) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${web.port}/tiny-speech/check.html?${query}`);
  await page.waitForFunction(() => window.tinySpeechCheck);
  return { context, page, errors };
}

test("with the site's own engine files, the voice and speech to text work and nothing leaves the origin", { skip }, async () => {
  web.leaks.length = 0;
  web.requests.length = 0;
  const { context, page, errors } = await checkPage("app=mapsma&engines=/mirror/");
  assert.match(await page.textContent("#about"), /engine files from this site: \/mirror\//);
  await page.click("#loadAsr");
  await page.waitForSelector("#heard .ok", { timeout: 20000 });
  const trip = await page.evaluate(() => window.tinySpeechCheck.roundTrip());
  await context.close();
  assert.ok(!trip.error, trip.error);
  assert.match(trip.heard, /what is open tonight \d+/, "the voice's audio reached speech to text");
  assert.deepEqual(web.leaks, [], "no request for another host");
  assert.deepEqual(errors, []);
  const mirrored = web.requests.filter((r) => r.path.startsWith("/mirror/")).map((r) => r.path);
  for (const want of ["/mirror/cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/index.js", "/mirror/cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js",
    "/mirror/cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort.wasm.min.js", "/mirror/huggingface.co/n4ze3m/tiny-voca/resolve/d94d2a0338fd1e0eab7dd896ec0ad23d8cdf7c14/onnx/model.onnx"]) {
    assert.ok(mirrored.includes(want), `${want} came from the site`);
  }
  const sent = web.requests.filter((r) => r.bytes > 0 || !["GET", "HEAD"].includes(r.method));
  assert.deepEqual(sent, [], "no request carried a body: the recording stayed in the page");
  assert.ok(web.requests.every((r) => r.url.length < 2000), "nothing hidden in an address either");
});

test("without them, the same page asks the libraries' own hosts (so the check above would see a leak)", { skip }, async () => {
  web.leaks.length = 0;
  const { context, page } = await checkPage("app=mapsma");
  await page.click("#loadAsr");
  await page.waitForSelector("#heard .ok, #heard .bad", { timeout: 20000 });
  await context.close();
  assert.ok(web.leaks.some((l) => /cdn\.jsdelivr\.net/.test(l)), `leaks seen: ${web.leaks.join(", ")}`);
});
