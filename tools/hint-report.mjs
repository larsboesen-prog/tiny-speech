// The recognizer's name hint for every city in packs/dist, counted with Whisper's own tokenizers (plan step B9; review 1.3):
// which names fit in the budget, in each language's model, and which do not (those are left to sound matching).
// node tools/hint-report.mjs [--budget 220]   → docs/hint-report.md
// The tokenizers (about 2.4 MB each) are fetched once from Hugging Face into ~/.cache/tiny-speech/ (or $TS_CACHE).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createBpe } from "../engines/whisper-tokens.js";
import { hintNames, fitHint } from "../core/pack/hint.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const MODELS = { en: "onnx-community/whisper-tiny.en", es: "onnx-community/whisper-tiny" };
export const tokenizerPath = (model) => join(process.env.TS_CACHE || join(homedir(), ".cache", "tiny-speech"), "tokenizers", model.replace(/\//g, "__") + ".json");

export async function tokenizer(model) {
  const file = tokenizerPath(model);
  if (!existsSync(file)) {
    const r = await fetch(`https://huggingface.co/${model}/resolve/main/tokenizer.json`);
    if (!r.ok) throw new Error(`${model} tokenizer: ${r.status}`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  }
  return createBpe(JSON.parse(readFileSync(file, "utf8")));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--budget"), budget = i > 0 ? +process.argv[i + 1] : 220;
  const { loadCore } = await import("../test/golden/mapsma.mjs");
  const index = JSON.parse(readFileSync(ROOT + "packs/dist/index.json", "utf8"));
  const lines = ["# The recognizer's name hint, per city and language", "",
    `Made by \`tools/hint-report.mjs\` with Whisper's own tokenizers; budget ${budget} tokens (Whisper reads at most 223). The page sends`,
    "the names in this order and the speech worker packs them with the same count (`browser/asr-worker.js`); a name that does not",
    "fit is still found afterwards by sound matching.", ""];
  for (const city of index.cities) {
    const { pack } = await loadCore(undefined, city.id);
    for (const lang of pack.langs || ["en"]) {
      const bpe = await tokenizer(MODELS[lang] || MODELS.en);
      const h = fitHint(hintNames(pack, lang), budget, bpe.count);
      lines.push(`## ${pack.names.en} (${city.id}), ${lang}: ${h.used.length} names, ${h.tokens} tokens (${MODELS[lang] || MODELS.en})`, "",
        h.text, "", `Did not fit (${h.left.length}): ${h.left.map((x) => x.name).join(", ") || "none"}.`, "");
      console.log(`${city.id} ${lang}: ${h.used.length} names in ${h.tokens} tokens, ${h.left.length} left out`);
    }
  }
  writeFileSync(ROOT + "docs/hint-report.md", lines.join("\n"));
}
