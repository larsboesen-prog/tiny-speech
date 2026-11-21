// The GitHub Pages demo (demo/index.html): the repository served as Pages serves it (the root as a plain folder), in Chromium with a
// fake microphone that plays a recorded Mexican Spanish question. Checked: the tiny ears hear it as the probe did, the reader answers
// in Spanish, MX1 speaks; typed English and Spanish questions answer in their language; nothing but GET requests for files leaves.
// Needs cdn.jsdelivr.net (onnxruntime-web) and Playwright's Chromium.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join, normalize, extname } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
let chromium = null;
try { ({ chromium } = require("playwright")); } catch { /* not installed */ }
const MODEL = "engines/ears/ears-int8-2026-11-20.onnx";
const skip = !chromium ? "Playwright is not installed" : !existsSync(ROOT + MODEL) ? `no ${MODEL} here (training/ears/README.md)` : false;
const CLIP = JSON.parse(readFileSync(ROOT + "test/fixtures/ears/clips.json", "utf8")).clips.find((c) => /raindog/i.test(c.said));
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html; charset=utf-8", ".json": "application/json", ".wav": "audio/wav" };

let server, port, browser;
const requests = [];
before(async () => {
  if (skip) return;
  server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    try { if ((await stat(file)).isDirectory()) file = join(file, "index.html"); const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "content-length": body.length }); res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  browser = await chromium.launch({
    ...(proxy ? { proxy: { server: proxy, bypass: "localhost,127.0.0.1" } } : {}),
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${ROOT}test/fixtures/ears/${CLIP.wav}%noloop`,
      "--autoplay-policy=no-user-gesture-required"],
  });
});
after(async () => { await browser?.close(); server?.close(); });

async function open() {
  const context = await browser.newContext({ permissions: ["microphone"] });
  context.on("request", (r) => requests.push({ method: r.method(), url: r.url(), body: r.postDataBuffer()?.length || 0 }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${port}/demo/`);
  await page.waitForFunction(() => window.tinySpeechDemo && Object.values(window.tinySpeechDemo.ready).every(Boolean), null, { timeout: 150000 });
  return { page, errors };
}
const text = (page, id) => page.evaluate((i) => document.getElementById(i).innerText, id);

test("typed questions: English answers in English, Spanish in Spanish, and MX1 speaks them", { skip, timeout: 240000 }, async () => {
  const { page, errors } = await open();
  await page.fill("#q", "Is La Azotea open now?");
  await page.click("#typed button[type=submit]");
  await page.waitForFunction(() => /first sound/.test(document.getElementById("answerMeta").textContent), null, { timeout: 30000 });
  assert.match(await text(page, "answer"), /La Azotea/);
  assert.match(await text(page, "heardMeta"), /English/);
  await page.click(".chip >> text=¿Dónde hay tacos al pastor?");
  await page.waitForFunction(() => /Spanish/.test(document.getElementById("heardMeta").textContent) && /first sound/.test(document.getElementById("answerMeta").textContent), null, { timeout: 30000 });
  assert.match(await text(page, "answer"), /taco|pastor|lugar|abiert/i);
  console.log(JSON.stringify({ en: "Is La Azotea open now?", es: await text(page, "answer"), meta: await text(page, "answerMeta") }));
  assert.deepEqual(errors, []);
});

test("a spoken question through the microphone: heard by the tiny ears, answered in Spanish, spoken by MX1", { skip, timeout: 240000 }, async () => {
  const { page, errors } = await open();
  await page.click("#mic");
  await page.waitForFunction(() => document.getElementById("heard").textContent !== "—" && /first sound/.test(document.getElementById("answerMeta").textContent), null, { timeout: 60000 });
  const heard = await text(page, "heard");
  console.log(JSON.stringify({ said: CLIP.said, heard, how: await text(page, "heardMeta"), answer: await text(page, "answer"), meta: await text(page, "answerMeta") }));
  assert.equal(heard, CLIP.probe_heard, "the same words the probe heard in this recording");
  assert.match(await text(page, "heardMeta"), /Spanish/);
  assert.match(await text(page, "answer"), /Raindog/);
  assert.deepEqual(errors, []);
});

test("nothing leaves the device but requests for files", { skip }, () => {
  const out = requests.filter((r) => !/^(http:\/\/localhost|blob:|data:)/.test(r.url));
  assert.deepEqual(out.filter((r) => r.method !== "GET" || r.body), [], "no request carries a body (no sound, no text)");
  const hosts = [...new Set(out.map((r) => new URL(r.url).host))].sort();
  assert.ok(hosts.every((h) => ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"].includes(h)), hosts.join(", "));
});

test("the microphone refused (as an app's built-in browser or a remembered 'Don't allow' does): the page says how to allow it", { skip, timeout: 240000 }, async () => {
  const { devices } = require("playwright");
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const strict = await chromium.launch({ ...(proxy ? { proxy: { server: proxy, bypass: "localhost,127.0.0.1" } } : {}),
    args: ["--use-fake-device-for-media-stream", "--deny-permission-prompts"] });  // a microphone, but the prompt refused
  try {
    const page = await (await strict.newContext({ ...devices["iPhone 13"] })).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`http://localhost:${port}/demo/`);
    await page.waitForFunction(() => window.tinySpeechDemo && window.tinySpeechDemo.ready.ears && window.tinySpeechDemo.ready.pack, null, { timeout: 150000 });
    await page.click("#mic");
    await page.waitForSelector("#micHelp:not([hidden])", { timeout: 10000 });
    const help = await page.evaluate(() => document.getElementById("micHelp").innerText);
    console.log(JSON.stringify({ state: await text(page, "state"), help }));
    assert.match(help, /Open in Safari/);
    assert.match(help, /Website Settings › Microphone › Allow/);
    assert.match(help, /Not(Allowed|Supported)Error/, "the refusal as the browser named it (headless Chromium as an iPhone: NotSupportedError)");
    assert.deepEqual(errors, []);
  } finally { await strict.close(); }
});
