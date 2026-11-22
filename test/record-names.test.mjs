// The name recorder (record-names/, owner 22 Nov 2026: "a simple page where I can record 30 to 50 place names once in [the owner's] own voice"):
// in Chromium with a fake microphone saying "Is Estoril open?", one take is kept, survives a reload, and is saved as the file
// tools/names-test.mjs reads (16 kHz 16-bit mono WAV in base64). Nothing goes over the network but the page's own files.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join, normalize, extname } from "node:path";

const require = createRequire(import.meta.url);
let chromium = null;
try { ({ chromium } = require("playwright")); } catch { /* not installed */ }
const skip = chromium ? false : "Playwright is not installed";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TYPES = { ".js": "text/javascript", ".html": "text/html; charset=utf-8", ".json": "application/json" };
let server, port, browser;
before(async () => {
  if (skip) return;
  server = createServer(async (req, res) => {
    let file = normalize(join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname)));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    try { if ((await stat(file)).isDirectory()) file = join(file, "index.html"); const body = await readFile(file); res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" }); res.end(body); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
  browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${ROOT}test/fixtures/ears/acc-67-0-da_DK-talesyntese-medium.wav%noloop`] });
});
after(async () => { await browser?.close(); server?.close(); });

test("the recorder keeps a take, remembers it, and saves the file the names test reads", { skip, timeout: 120000 }, async () => {
  const context = await browser.newContext({ permissions: ["microphone"], acceptDownloads: true });
  const urls = [];
  context.on("request", (r) => urls.push(r.url()));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${port}/record-names/`);
  await page.waitForFunction(() => !document.getElementById("rec").disabled);
  const names = JSON.parse(readFileSync(ROOT + "record-names/names.json", "utf8")).names;
  assert.equal(names.length, 40);
  assert.equal(await page.textContent("#say"), "“Is Estoril open?”");
  assert.equal(await page.locator("#list li").count(), 40);
  await page.click("#rec");
  await page.waitForFunction(() => /^Kept/.test(document.getElementById("state").textContent), null, { timeout: 30000 });
  assert.equal(await page.textContent("#prog"), "1 of 40 recorded");
  assert.match(await page.textContent("#list li:first-child small"), /^✓ \d\.\d s$/);
  assert.equal(await page.textContent("#say"), "“Is La Azotea open?”", "on to the next name");
  await page.reload();
  await page.waitForFunction(() => /1 of 40/.test(document.getElementById("prog").textContent));
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#save")]);
  assert.match(download.suggestedFilename(), /^my-place-names-\d{4}-\d\d-\d\d\.json$/);
  const saved = JSON.parse(readFileSync(await download.path(), "utf8"));
  assert.equal(saved.names.length, 1);
  assert.deepEqual([saved.names[0].id, saved.names[0].name, saved.names[0].prompt], ["67", "Estoril", "Is Estoril open?"]);
  const wav = Buffer.from(saved.names[0].wav, "base64");
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.deepEqual([wav.readUInt16LE(22), wav.readUInt32LE(24), wav.readUInt16LE(34)], [1, 16000, 16], "mono, 16 kHz, 16-bit");
  const seconds = (wav.length - 44) / 32000;
  assert.ok(seconds > 1 && seconds < 3.5, `the speech, cut as the page cuts it: ${seconds} s`);
  assert.deepEqual(urls.filter((u) => !u.startsWith(`http://localhost:${port}/`)), [], "nothing leaves the device");
  assert.deepEqual(errors, []);
  await context.close();
});
