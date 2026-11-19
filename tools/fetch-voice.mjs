// Downloads tiny-voca's plain-JS model (7,988,384 bytes) into vendor/tiny-voca/, checked against its SHA-256: for the voice tests
// and for a site that serves its own copy. node tools/fetch-voice.mjs
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { MODEL, MODEL_URL } from "../engines/tinyvoca-js.js";

const out = fileURLToPath(new URL("../vendor/tiny-voca/tiny-voca-js.gguf", import.meta.url));
const sha = (b) => createHash("sha256").update(b).digest("hex");
if (existsSync(out) && sha(readFileSync(out)) === MODEL.sha256) { console.log("already here:", out); process.exit(0); }
const r = await fetch(MODEL_URL);
if (!r.ok) { console.error(`${MODEL_URL}: ${r.status}`); process.exit(1); }
const bytes = Buffer.from(await r.arrayBuffer());
if (sha(bytes) !== MODEL.sha256) { console.error("downloaded file does not match its SHA-256"); process.exit(1); }
writeFileSync(out, bytes);
console.log(`${bytes.length} bytes → ${out}`);
