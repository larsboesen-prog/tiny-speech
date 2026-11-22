// What each part of the voice core weighs, measured from the files (plan step B11; review 1.8): raw, gzip and brotli, per file
// and per part, and the totals of the paths a page takes. Generates docs/sizes.md (the table for ARCHITECTURE.md section 4).
//   node tools/sizes.mjs [--engines DIR]
// The engine files (Whisper, onnxruntime, Pyodide, tiny-voca) are listed in browser/engines.json; with --engines DIR (the folder
// tools/manifest.mjs --fetch filled) their compressed sizes are measured too and kept in engines.json for the next run.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gzipSync, brotliCompressSync, constants } from "node:zlib";
import { join } from "node:path";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { coreFiles } from "./manifest.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENGINES = ROOT + "browser/engines.json";

/** {bytes, gzip, brotli} of some bytes; brotli at its best for small files, at 9 for large ones (11 takes minutes on 30 MB). */
export function measure(bytes) {
  const quality = bytes.length > 1e6 ? 9 : 11;
  return { bytes: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length,
    brotli: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: quality, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length } }).length };
}

const sum = (list) => list.reduce((s, x) => ({ bytes: s.bytes + x.bytes, gzip: s.gzip + (x.gzip ?? x.bytes), brotli: s.brotli + (x.brotli ?? x.bytes) }), { bytes: 0, gzip: 0, brotli: 0 });
const mb = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${(n / 1e3).toFixed(1)} KB`);

export function parts({ enginesDir = null } = {}) {
  const engines = JSON.parse(readFileSync(ENGINES, "utf8"));
  let changed = false;
  for (const f of engines.files) {
    if (f.gzip != null || !enginesDir || !existsSync(join(enginesDir, f.path))) continue;
    Object.assign(f, measure(readFileSync(join(enginesDir, f.path))));
    changed = true;
  }
  if (changed) writeFileSync(ENGINES, JSON.stringify(engines, null, 1) + "\n");
  const files = engines.files;
  const role = (r, only = false) => files.filter((f) => f.for.includes(r) && (!only || f.for.length === 1));
  const runtime = files.filter((f) => f.for.includes("asr-en") && f.for.includes("asr-es"));
  const core = coreFiles();
  const local = (pred) => Object.keys(core).filter(pred).map((p) => ({ path: p, ...measure(readFileSync(ROOT + p)) }));
  const isCode = (p) => /\.(js|mjs)$/.test(p);
  const packs = JSON.parse(readFileSync(ROOT + "packs/dist/index.json", "utf8")).cities.map((c) => {
    const manifestPath = "packs/dist/" + c.manifest, m = JSON.parse(readFileSync(ROOT + manifestPath, "utf8"));
    const dir = manifestPath.replace(/manifest\.json$/, "");
    const list = [manifestPath, dir + m.files.base.path, join(dir, m.files.live.path)].map((p) => ({ path: p, ...measure(readFileSync(ROOT + p)) }));
    const ears = dir.replace(/[^/]+\/$/, "") + "ears-lexicon.json";  // the tiny ears' word list, beside the city's versions
    return { id: c.id, places: m.counts.places, list, total: sum(list), ears: existsSync(ROOT + ears) ? [{ path: ears, ...measure(readFileSync(ROOT + ears)) }] : [] };
  });
  // the tiny ears' model is the site's own file (engines/ears/, CC BY-SA 4.0: models/ears.md); the newest (the one pages load), when here
  const earsModel = existsSync(ROOT + "engines/ears") ? readdirSync(ROOT + "engines/ears").filter((f) => /\.onnx$/.test(f)).sort().slice(-1).map((f) => ({ path: "engines/ears/" + f, ...measure(readFileSync(ROOT + "engines/ears/" + f)) })) : [];
  return {
    engines,
    rows: [
      { part: "Ears: transformers.js + its onnxruntime (both languages)", list: runtime },
      { part: "Ears, English: Whisper tiny.en, 8-bit", list: role("asr-en", true) },
      { part: "Ears, Spanish: Whisper tiny (multilingual), 8-bit", list: role("asr-es", true) },
      { part: "Tiny ears: onnxruntime-web 1.18, one thread (its engine file is also today's voice's)", list: role("asr-ears") },
      ...(earsModel.length ? [{ part: "Tiny ears: the model, 8-bit (both languages)", list: earsModel }] : []),
      ...packs.filter((p) => p.ears.length).map((p) => ({ part: `Tiny ears: ${p.id}'s word list`, list: p.ears })),
      { part: "Voice today: tiny-voca ONNX + onnxruntime 1.18 + Pyodide (dizione)", list: role("voice") },
      { part: "Voice, plain JS: tiny-voca GGUF", list: role("voiceJs") },
      { part: "Core code: browser/, core/, lang/, domains/, engines/ (JavaScript)", list: local((p) => isCode(p) && !p.startsWith("vendor/")) },
      { part: "tiny-voca's plain-JS runtime (vendor/tiny-voca/js)", list: local((p) => p.startsWith("vendor/")) },
      { part: "Site configs and data the core reads (apps/, lang/*.json)", list: local((p) => !isCode(p)) },
      ...packs.map((p) => ({ part: `City pack ${p.id} (${p.places} places)`, list: p.list })),
    ].map((r) => ({ ...r, total: sum(r.list) })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--engines");
  const { rows, engines } = parts({ enginesDir: i > 0 ? process.argv[i + 1] : null });
  const at = (prefix) => rows.find((r) => r.part.startsWith(prefix)).total;
  const path = (names) => sum(names.map(at));
  const measured = engines.files.every((f) => f.gzip != null);
  const paths = [
    ["MapSMA English today (ears + ONNX voice + core + pack)", ["Ears: transformers", "Ears, English", "Voice today", "Core code", "Site configs", "City pack mx-sma"]],
    ["MapSMA English, plain-JS voice", ["Ears: transformers", "Ears, English", "Voice, plain JS", "Core code", "tiny-voca's plain-JS", "Site configs", "City pack mx-sma"]],
    ["… and Spanish questions (second Whisper)", ["Ears: transformers", "Ears, English", "Ears, Spanish", "Voice, plain JS", "Core code", "tiny-voca's plain-JS", "Site configs", "City pack mx-sma"]],
    ["MapSMA with the tiny ears (both languages), plain-JS voice", ["Tiny ears: onnxruntime", "Tiny ears: the model", "Tiny ears: mx-sma", "Voice, plain JS", "Core code", "tiny-voca's plain-JS", "Site configs", "City pack mx-sma"]],
    ["CredBrief (ears English + ONNX voice + core)", ["Ears: transformers", "Ears, English", "Voice today", "Core code", "Site configs"]],
  ];
  const lines = ["# Sizes, measured", "",
    `Made by \`tools/sizes.mjs\` from the files themselves: the core's in this repository, the engine files listed in \`browser/engines.json\``,
    `(recorded ${engines.recorded} from the real libraries, each with its SHA-256)${measured ? "" : "; engine files not measured compressed (run with --engines DIR)"}.`,
    "Brotli at quality 11, or 9 for files over 1 MB. What crosses the network depends on the server: jsDelivr compresses its files,",
    "Hugging Face sends model files as they are; once stored on the phone, nothing is downloaded again.", "",
    "| Part | Files | Raw | gzip | brotli |", "|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.part} | ${r.list.length} | ${mb(r.total.bytes)} | ${mb(r.total.gzip)} | ${mb(r.total.brotli)} |`), "",
    "| A page's first visit | Raw | brotli |", "|---|---|---|",
    ...paths.map(([name, parts]) => { const t = path(parts); return `| ${name} | ${mb(t.bytes)} | ${mb(t.brotli)} |`; }), "",
    "## Every file", "", "| File | Raw | gzip | brotli |", "|---|---|---|---|",
    ...rows.flatMap((r) => r.list.map((f) => `| ${f.path || f.url} | ${f.bytes} | ${f.gzip ?? "—"} | ${f.brotli ?? "—"} |`)), ""];
  writeFileSync(ROOT + "docs/sizes.md", lines.join("\n"));
  console.log(lines.slice(0, 7 + rows.length + 3 + paths.length).join("\n"));
}
