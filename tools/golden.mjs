// The golden snapshot: what MapSMA's reader and asker (as served on 18 Nov 2026) say to every question in
// test/golden/questions-mapsma.json, in English at three clocks and in Spanish at one.
//   node tools/golden.mjs           print a count, and the differences against the snapshot
//   node tools/golden.mjs --update  rewrite the snapshot from the original files (only on purpose; reviewed as a diff)
//   node tools/golden.mjs --digest  rewrite test/golden/mapsma-digest.md: question → first spoken sentence, for reading by eye
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSite, loadCore } from "../test/golden/mapsma.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const SNAPSHOT = ROOT + "test/golden/mapsma.snapshot.jsonl";
export const ORIGINAL = ROOT + "test/fixtures/before/mapsma-page5";

/** Every case: {key, turns}, for MapSMA's original files (a folder) or "core" (domains/places with the built pack). */
export async function runAll(dir = ORIGINAL) {
  const site = dir === "core" ? await loadCore() : await loadSite(dir);
  const q = JSON.parse(readFileSync(ROOT + "test/golden/questions-mapsma.json", "utf8"));
  const cases = [];
  for (const conversation of q.conversations) {
    for (const clock of q.clocks) cases.push({ key: { conversation, clock, lang: "en" }, turns: site.run(conversation, clock, "en") });
    cases.push({ key: { conversation, clock: q.clocks[0], lang: "es" }, turns: site.run(conversation, q.clocks[0], "es") });
  }
  return cases;
}

export const lines = (cases) => cases.map((c) => JSON.stringify(c)).join("\n") + "\n";

/** Differences between two runs, as short readable entries. */
export function differences(expected, actual, max = 20) {
  const out = [];
  const a = expected.trim().split("\n"), b = actual.trim().split("\n");
  if (a.length !== b.length) out.push(`case count: snapshot ${a.length}, now ${b.length}`);
  for (let i = 0; i < Math.min(a.length, b.length) && out.length < max; i++) {
    if (a[i] === b[i]) continue;
    const x = JSON.parse(a[i]), y = JSON.parse(b[i]);
    out.push(`${JSON.stringify(x.key)}\n  snapshot: ${JSON.stringify(x.turns).slice(0, 400)}\n  now:      ${JSON.stringify(y.turns).slice(0, 400)}`);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cases = await runAll(process.argv.includes("--core") ? "core" : ORIGINAL);
  const now = lines(cases);
  if (process.argv.includes("--update")) {
    writeFileSync(SNAPSHOT, now);
    console.log(`wrote ${cases.length} cases to ${SNAPSHOT.slice(ROOT.length)} (${(now.length / 1024).toFixed(0)} KB)`);
  } else if (process.argv.includes("--digest")) {
    const rows = cases.filter((c) => c.key.lang === "en" && c.key.clock === "tue-14:10" || c.key.lang === "es").map((c) => {
      const t = c.turns.at(-1);
      const said = (t.answer.say || []).map((s) => s.text).join(" ").replace(/\|/g, "/");
      return `| ${c.key.conversation.join(" → ").replace(/\|/g, "/")} | ${c.key.lang} | ${t.answer.kind || ""} | ${said.slice(0, 220)} |`;
    });
    writeFileSync(ROOT + "test/golden/mapsma-digest.md",
      "# MapSMA answers today (golden snapshot digest)\n\nTuesday 14:10 in San Miguel; English and Spanish answers. Full answers at three clocks: `mapsma.snapshot.jsonl`.\n\n| Question | Answer in | Kind | Says |\n|---|---|---|---|\n" + rows.join("\n") + "\n");
    console.log(`digest: ${rows.length} rows`);
  } else {
    const diff = differences(readFileSync(SNAPSHOT, "utf8"), now);
    console.log(diff.length ? diff.join("\n") : `${cases.length} cases, same as the snapshot`);
  }
}
