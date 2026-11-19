// The pack loader in Chromium (plan step B5): download and check, keep on the device, offline, damaged files, a pack too new
// for this core, at most N cities, and the places domain answering from a pack loaded in the browser.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startServer } from "./harness/server.mjs";

const require = createRequire(import.meta.url);
let chromium = null;
try { ({ chromium } = require("playwright")); } catch { /* not installed: skipped */ }
const skip = chromium ? false : "Playwright is not installed";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const index = JSON.parse(readFileSync(ROOT + "packs/dist/index.json", "utf8"));
const sma = index.cities.find((c) => c.id === "mx-sma");
const manifest = JSON.parse(readFileSync(ROOT + "packs/dist/" + sma.manifest, "utf8"));
const TUE_1410 = "2026-11-17T20:10:00Z";

let web, browser;
before(async () => { if (skip) return; web = await startServer(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); web?.server.close(); });

async function page(context) {
  const p = await context.newPage();
  await p.goto(`http://localhost:${web.port}/harness/packs.html`);
  await p.waitForFunction(() => window.ready);
  return p;
}
const hits = (path) => web.hits[path] || 0;
const baseFile = `/packs/${sma.manifest.replace("manifest.json", "base.json")}`;

// A newer version of San Miguel, served by routes: its manifest, and base.json as `base` (by default, the real one).
async function newerVersion(context, { base = null, core = manifest.core } = {}) {
  const version = "2026-12-01.ffffff";
  const newIndex = { ...index, cities: index.cities.map((c) => (c.id === "mx-sma" ? { ...c, version, manifest: `mx-sma/${version}/manifest.json` } : c)) };
  await context.route("**/packs/index.json", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(newIndex) }));
  await context.route(`**/packs/mx-sma/${version}/manifest.json`, (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ...manifest, version, core }) }));
  await context.route(`**/packs/mx-sma/${version}/base.json`, (r) => r.fulfill({ contentType: "application/json", body: base ?? readFileSync(ROOT + "packs/dist" + baseFile.slice(6), "utf8") }));
  return version;
}

test("a city is downloaded, checked, kept, and then read from the device", { skip }, async () => {
  const context = await browser.newContext();
  const p = await page(context);
  const before = hits(baseFile);
  const first = await p.evaluate(() => window.loadCity("mx-sma"));
  assert.deepEqual([first.from, first.version, first.places, first.tz], ["network", sma.version, 96, "America/Mexico_City"]);
  const second = await p.evaluate(() => window.loadCity("mx-sma"));
  assert.equal(second.from, "device");
  assert.equal(hits(baseFile) - before, 1, "base.json was downloaded once");
  const stored = await p.evaluate(() => window.cacheNames());
  assert.equal(stored["t-pack-mx-sma"].length, 3, "manifest, base and live");
  await context.close();
});

test("offline, the last good version answers", { skip }, async () => {
  const context = await browser.newContext();
  const p = await page(context);
  await p.evaluate(() => window.loadCity("mx-sma"));
  await context.route("**/packs/**", (r) => r.abort("internetdisconnected"));
  const off = await p.evaluate(() => window.loadCity("mx-sma"));
  assert.deepEqual([off.from, off.version, off.places, off.offline], ["device", sma.version, 96, true]);
  await context.close();
});

test("a new version that does not check out is refused, and the stored one kept", { skip }, async () => {
  const context = await browser.newContext();
  const p = await page(context);
  await p.evaluate(() => window.loadCity("mx-sma"));
  await newerVersion(context, { base: readFileSync(ROOT + "packs/dist" + baseFile.slice(6), "utf8").replace("La Azotea", "La Azotea!") });
  const r = await p.evaluate(() => window.loadCity("mx-sma"));
  assert.deepEqual([r.from, r.version], ["device", sma.version]);
  assert.match(r.warning, /base\.json: SHA-256 does not match/);
  const stored = await p.evaluate(() => window.cacheNames());
  assert.ok(stored["t-pack-mx-sma"].some((u) => u.includes(sma.version)), "the old version's files are still there");
  await context.close();
});

test("a new version that checks out replaces the stored one", { skip }, async () => {
  const context = await browser.newContext();
  const p = await page(context);
  await p.evaluate(() => window.loadCity("mx-sma"));
  const version = await newerVersion(context);
  const r = await p.evaluate(() => window.loadCity("mx-sma"));
  assert.deepEqual([r.from, r.version], ["network", version]);
  const stored = (await p.evaluate(() => window.cacheNames()))["t-pack-mx-sma"];
  assert.ok(stored.every((u) => !u.includes(sma.version)), "the old version's files are gone");
  await context.close();
});

test("a pack this core cannot read is refused with a plain reason", { skip }, async () => {
  const context = await browser.newContext();
  const p = await page(context);
  await newerVersion(context, { core: ">=9 <10" });
  const r = await p.evaluate(() => window.loadCity("mx-sma"));
  assert.match(r.error, /needs core >=9 <10; this is 0\.2\.0/);
  await context.close();
});

test("at most maxCities cities stay on the device", { skip }, async () => {
  const context = await browser.newContext();
  const p = await page(context);
  await p.evaluate(() => window.loadCity("mx-sma", { maxCities: 1 }));
  const r = await p.evaluate(() => window.loadCity("xx-test", { maxCities: 1 }));
  assert.deepEqual(r.stored, ["xx-test"]);
  assert.ok(!("t-pack-mx-sma" in (await p.evaluate(() => window.cacheNames()))));
  await context.close();
});

test("a damaged copy on the device is downloaded again", { skip }, async () => {
  const context = await browser.newContext();
  const p = await page(context);
  await p.evaluate(() => window.loadCity("xx-test"));
  await p.evaluate(async () => {
    const cache = await caches.open("t-pack-xx-test");
    const key = (await cache.keys()).find((r) => r.url.endsWith("base.json"));
    await cache.put(key, new Response("{\"damaged\": true}"));
  });
  const r = await p.evaluate(() => window.loadCity("xx-test"));
  assert.equal(r.from, "network");
  assert.equal(r.places, 14);
  await context.close();
});

test("the places domain answers in the browser from a loaded pack", { skip }, async () => {
  const context = await browser.newContext();
  const p = await page(context);
  const a = await p.evaluate((iso) => window.ask("mx-sma", "Is La Azotea open?", iso), TUE_1410);
  assert.deepEqual([a.kind, a.ids], ["one", ["60"]]);
  const b = await p.evaluate((iso) => window.ask("xx-test", "pizza in Barrio Alto", iso), "2026-11-17T18:30:00Z");
  assert.deepEqual(b.ids, ["T5"]);
  const c = await p.evaluate((iso) => window.ask("mx-sma", "¿qué hay abierto para cenar?", iso, "es"), TUE_1410);
  assert.match(c.say, /^Aquí tienes/);
  await context.close();
});
