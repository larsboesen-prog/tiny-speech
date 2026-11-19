// Loading city packs in the browser (plan step B5): index.json → a city's manifest → its files, each checked against the
// manifest's SHA-256 before anything is stored or used. A new version replaces the stored one only after every file has checked
// out; offline, or when a download fails or does not check out, the last good version answers. At most `maxCities` cities stay
// on the device (the least recently used goes first). Works in a page or a worker: it needs fetch, Cache Storage and crypto.subtle.
import { assemble } from "./assemble.js";

export const CORE_VERSION = "0.2.0";

/** Does `version` (x.y.z) satisfy a range like ">=0.2 <1"? */
export function satisfies(version, range) {
  const v = version.split(".").map(Number);
  const cmp = (a) => { const b = a.split(".").map(Number); for (let i = 0; i < 3; i++) { const d = (v[i] || 0) - (b[i] || 0); if (d) return d; } return 0; };
  return String(range || "").trim().split(/\s+/).filter(Boolean).every((part) => {
    const m = /^(>=|<=|>|<|=)?(\d+(?:\.\d+){0,2})$/.exec(part);
    if (!m) return false;
    const c = cmp(m[2]);
    return { ">=": c >= 0, "<=": c <= 0, ">": c > 0, "<": c < 0, "=": c === 0, undefined: c === 0 }[m[1]];
  });
}

export function createPackLoader({ base = "/packs/", cachePrefix = "tiny-speech", maxCities = 3, coreVersion = CORE_VERSION,
  fetch: get = (...a) => globalThis.fetch(...a), caches: store = globalThis.caches, subtle = globalThis.crypto?.subtle } = {}) {
  const root = new URL(base, globalThis.location?.href || "http://localhost/");
  const META = new URL("__tiny-speech-packs.json", root).href;  // which version of each city is stored, and when it was last used
  const metaCache = () => store.open(`${cachePrefix}-packs`);
  const cityCache = (id) => store.open(`${cachePrefix}-pack-${id}`);
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const sha256 = async (text) => hex(await subtle.digest("SHA-256", new TextEncoder().encode(text)));

  async function readMeta() {
    try { const r = await (await metaCache()).match(META); return r ? await r.json() : { cities: {} }; } catch { return { cities: {} }; }
  }
  async function writeMeta(meta) {
    await (await metaCache()).put(META, new Response(JSON.stringify(meta), { headers: { "content-type": "application/json" } }));
  }

  /** The cities: from the network (no-cache), else the copy stored with the last good load. */
  async function list() {
    try {
      const r = await get(new URL("index.json", root).href, { cache: "no-cache" });
      if (!r.ok) throw new Error(`index.json: ${r.status}`);
      const text = await r.text();
      const index = JSON.parse(text);
      await (await metaCache()).put(new URL("index.json", root).href, new Response(text, { headers: { "content-type": "application/json" } }));
      return { index, from: "network" };
    } catch (error) {
      const r = await (await metaCache()).match(new URL("index.json", root).href);
      if (!r) throw new Error(`no list of cities: ${error.message}`);
      return { index: await r.json(), from: "device" };
    }
  }

  // A version's three files, fetched and checked (nothing stored yet).
  async function download(entry) {
    const manifestUrl = new URL(entry.manifest, root);
    const r = await get(manifestUrl.href);
    if (!r.ok) throw new Error(`${entry.manifest}: ${r.status}`);
    const manifestText = await r.text();
    const manifest = JSON.parse(manifestText);
    if (manifest.id !== entry.id || manifest.version !== entry.version) throw new Error(`${entry.manifest} is not ${entry.id} ${entry.version}`);
    if (!satisfies(coreVersion, manifest.core)) throw new Error(`${entry.id} ${entry.version} needs core ${manifest.core}; this is ${coreVersion}`);
    const files = { [manifestUrl.href]: manifestText };
    for (const f of Object.values(manifest.files)) {
      const url = new URL(f.path, manifestUrl).href;
      const fr = await get(url);
      if (!fr.ok) throw new Error(`${f.path}: ${fr.status}`);
      const text = await fr.text();
      if ((await sha256(text)) !== f.sha256) throw new Error(`${f.path}: SHA-256 does not match the manifest`);
      files[url] = text;
    }
    return { manifest, manifestUrl: manifestUrl.href, files };
  }

  // The stored version of a city, checked again (a device's storage can be damaged too).
  async function stored(id, meta) {
    const m = meta.cities[id];
    if (!m) return null;
    const cache = await cityCache(id);
    const mr = await cache.match(m.manifest);
    if (!mr) return null;
    const manifest = await mr.json();
    const parts = {};
    for (const [k, f] of Object.entries(manifest.files)) {
      const url = new URL(f.path, m.manifest).href;
      const r = await cache.match(url);
      if (!r) return null;
      const text = await r.text();
      if ((await sha256(text)) !== f.sha256) return null;
      parts[k] = JSON.parse(text);
    }
    return { manifest, parts };
  }

  async function keep(id, dl, meta) {
    const cache = await cityCache(id);
    for (const [url, text] of Object.entries(dl.files)) await cache.put(url, new Response(text, { headers: { "content-type": "application/json" } }));
    for (const req of await cache.keys()) if (!(req.url in dl.files)) await cache.delete(req);  // the old version, now replaced
    meta.cities[id] = { version: dl.manifest.version, manifest: dl.manifestUrl, used: Date.now() };
    // at most maxCities on the device: the least recently used goes (never the one just loaded)
    const others = Object.entries(meta.cities).filter(([c]) => c !== id).sort((a, b) => a[1].used - b[1].used);
    while (others.length + 1 > maxCities) {
      const [old] = others.shift();
      await store.delete(`${cachePrefix}-pack-${old}`);
      delete meta.cities[old];
    }
    await writeMeta(meta);
  }

  /**
   * A city's pack, ready for the domains. {pack, version, from: "network" | "device", offline?, warning?}: offline means the list of cities
   * could not be fetched (an answer can say its hours may be old).
   * A failed or unchecked download falls back to the stored version, with a warning saying why.
   */
  async function load(id) {
    const meta = await readMeta();
    let index = null, warning = null, offline = false;
    try { const l = await list(); index = l.index; offline = l.from === "device"; } catch (e) { warning = e.message; offline = true; }
    const entry = index?.cities.find((c) => c.id === id);
    const have = meta.cities[id];
    const fresh = async () => {
      const dl = await download(entry);
      await keep(id, dl, meta);
      const part = (k) => JSON.parse(dl.files[new URL(dl.manifest.files[k].path, dl.manifestUrl).href]);
      return { pack: assemble(dl.manifest, part("base"), part("live")), version: dl.manifest.version, from: "network" };
    };
    if (entry && (!have || have.version !== entry.version)) {
      try { return await fresh(); } catch (e) { warning = e.message; }
    }
    const s = await stored(id, meta);
    if (!s && entry && have && have.version === entry.version) {  // the stored copy is damaged: fetch it again
      try { return await fresh(); } catch (e) { warning = e.message; }
    }
    if (!s) throw new Error(`${id}: ${warning || (entry ? "the stored pack is damaged" : "no such city")}`);
    meta.cities[id].used = Date.now();
    meta.last = id;
    await writeMeta(meta);
    return { pack: assemble(s.manifest, s.parts.base, s.parts.live), version: s.manifest.version, from: "device", offline, ...(warning ? { warning } : {}) };
  }

  /** Switch to a city and remember it as the last one used. */
  async function setCity(id) {
    const r = await load(id);
    const meta = await readMeta();
    meta.last = id;
    await writeMeta(meta);
    return r;
  }

  return { list, load, setCity, lastCity: async () => (await readMeta()).last || null, storedCities: async () => Object.keys((await readMeta()).cities) };
}
