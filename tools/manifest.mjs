// The self-hosting manifest (plan step B13; review 1.7): every file the voice core needs, with its size and SHA-256, so a site
// serves its own copies (no third party sees the visitor, a changed file is noticed) and versions are content hashes, not
// hand-kept ?v= strings.
//   node tools/manifest.mjs                       browser/manifest.json: the core's own files + browser/engines.json
//   node tools/manifest.mjs --record DIZIONE.zip  browser/engines.json: run both workers with the real libraries (network) and
//                                                 list every file they fetch from other hosts, with size and SHA-256
//   node tools/manifest.mjs --fetch DIR           download every engine file to DIR/<host>/<path>, checking each SHA-256: then
//                                                 serve DIR as the site's engines folder (apps/*.json "engines": "/tiny-speech/engines/")
//   node tools/manifest.mjs --addresses APP       the worker addresses for apps/APP.json, each with ?v= its file's hash
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENGINES = ROOT + "browser/engines.json";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const CORE_DIRS = ["browser", "core", "domains", "lang", "engines", "apps", "vendor/tiny-voca/js"];

/** The core's own files: {path: {bytes, sha256}}, for the files a site serves (code and data; not tests, notes or the manifest). */
export function coreFiles() {
  const out = {};
  const walk = (dir) => {
    for (const name of readdirSync(join(ROOT, dir)).sort()) {
      const path = join(dir, name);
      if (statSync(join(ROOT, path)).isDirectory()) walk(path);
      else if (/\.(js|mjs|json|html)$/.test(name) && !/^(manifest|engines)\.json$/.test(name)) {
        const bytes = readFileSync(join(ROOT, path));
        out[path] = { bytes: bytes.length, sha256: sha(bytes) };
      }
    }
  };
  for (const dir of CORE_DIRS) walk(dir);
  return out;
}

// Where a site keeps an engine file: its address without https://; a package's own address (…/transformers@3.8.1), which is also
// a folder at its host (…@3.8.1/dist/…), as …@3.8.1/index.js. The workers' mirror() makes the same addresses.
export const mirrorPath = (url) => url.replace(/^https:\/\//, "").replace(/(@\d[\w.-]*)$/, "$1/index.js");
export const engines = () => (existsSync(ENGINES) ? JSON.parse(readFileSync(ENGINES, "utf8")) : { files: [] });

async function record(dizione) {
  const { createRequire } = await import("node:module");
  const { chromium } = createRequire(import.meta.url)("playwright");
  const { startServer } = await import("../test/harness/server.mjs");
  const web = await startServer({ dizione: readFileSync(dizione) });
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await chromium.launch(proxy ? { proxy: { server: proxy, bypass: "localhost,127.0.0.1" } } : {});
  // The browser gives the addresses (the first one asked for, before any redirect); Node then downloads each to measure it, as
  // large bodies and redirects are not kept by the browser's inspector.
  const files = new Map();  // address -> roles
  const watch = (context, role) => context.on("request", (request) => {
    if (request.redirectedFrom()) return;
    const url = request.url();
    if (!/^https:\/\//.test(url)) return;  // the page's own files (http://localhost) and blob: workers
    files.set(url, [...new Set([...(files.get(url) || []), role])]);
  });
  try {
    for (const [role, query, model] of [["asr-en", "", "onnx-community/whisper-tiny.en|"], ["asr-es", "", "onnx-community/whisper-tiny|es"],
      ["voice", "", null], ["voiceJs", "&voice=js", null]]) {
      const context = await browser.newContext();
      watch(context, role);
      const page = await context.newPage();
      await page.goto(`http://localhost:${web.port}/tiny-speech/check.html?app=record${query}`);
      await page.waitForFunction(() => window.tinySpeechCheck);
      if (model) {
        await page.selectOption("#model", model);
        await page.click("#loadAsr");
        await page.waitForSelector("#heard .ok, #heard .bad", { timeout: 600000 });
        console.log(role, (await page.textContent("#heard")).trim());
      } else {
        await page.click("#loadVoice");
        await page.waitForFunction(() => /Voice ready|bad/.test(document.querySelector("#spoken").innerHTML), null, { timeout: 600000 });
        console.log(role, (await page.textContent("#spoken")).trim());
      }
      await page.waitForTimeout(1500);
      await context.close();
    }
  } finally {
    await browser.close();
    web.server.close();
  }
  const list = [];
  for (const [url, roles] of [...files].sort((a, b) => a[0].localeCompare(b[0]))) {
    const r = await fetch(url);
    if (!r.ok) { console.error(`${url}: ${r.status}`); continue; }
    const body = Buffer.from(await r.arrayBuffer());
    list.push({ url, path: mirrorPath(url), bytes: body.length, sha256: sha(body), for: roles });
    console.log(`${String(body.length).padStart(10)}  ${roles.join(",")}  ${url}`);
  }
  writeFileSync(ENGINES, JSON.stringify({ recorded: new Date().toISOString().slice(0, 10), how: "node tools/manifest.mjs --record (real libraries, headless Chromium)",
    files: list }, null, 1) + "\n");
  console.log(`${list.length} engine files, ${(list.reduce((s, f) => s + f.bytes, 0) / 1e6).toFixed(1)} MB → browser/engines.json`);
}

async function fetchAll(dir) {
  for (const f of engines().files) {
    const file = join(dir, f.path);
    if (existsSync(file) && sha(readFileSync(file)) === f.sha256) continue;
    const r = await fetch(f.url);
    if (!r.ok) throw new Error(`${f.url}: ${r.status}`);
    const bytes = Buffer.from(await r.arrayBuffer());
    if (sha(bytes) !== f.sha256) throw new Error(`${f.url}: SHA-256 differs from the manifest (the file changed at its host)`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    console.log(`${f.path}  ${bytes.length}`);
  }
}

export function manifest() {
  return { made: new Date().toISOString().slice(0, 10), core: coreFiles(), engines: engines().files };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  if (arg("--record")) await record(arg("--record"));
  else if (arg("--fetch")) await fetchAll(arg("--fetch"));
  else if (arg("--addresses")) {
    const { workerUrl } = await import("../core/config.js");
    const config = JSON.parse(readFileSync(ROOT + `apps/${arg("--addresses")}.json`, "utf8"));
    const core = coreFiles(), v = (f) => core[`browser/${f}`].sha256.slice(0, 12);
    for (const [which, file] of [["asr", "asr-worker.js"], ["voice", "tinyvoca-worker.js"]]) console.log(workerUrl(config, which, { base: "/tiny-speech/browser/", v: v(file) }));
    for (const file of ["listen.js", "pcm-worklet.js"]) console.log(`/tiny-speech/browser/${file}?v=${v(file)}`);
  } else {
    const m = manifest();
    writeFileSync(ROOT + "browser/manifest.json", JSON.stringify(m, null, 1) + "\n");
    console.log(`browser/manifest.json: ${Object.keys(m.core).length} core files, ${m.engines.length} engine files`);
  }
}
