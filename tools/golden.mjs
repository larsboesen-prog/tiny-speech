// The golden snapshot: what MapSMA's reader and asker (as served on 18 Nov 2026) say to every question in
// test/golden/questions-mapsma.json, in English at three clocks and in Spanish at one. The shared core must give the same
// answers with the pack as it was imported (test/fixtures/before/mx-sma-pack): that tests the code. San Miguel's pack has
// changed since (new places, music nights); what it answers now is a second snapshot, re-recorded on purpose with a report.
//   node tools/golden.mjs                     print a count, and the differences against the snapshot
//   node tools/golden.mjs --update            rewrite the snapshot from the original files (only on purpose; reviewed as a diff)
//   node tools/golden.mjs --digest            rewrite test/golden/mapsma-digest.md: question → first spoken sentence
//   node tools/golden.mjs --current           the current pack's differences against its snapshot
//   node tools/golden.mjs --current --update  re-record it, and write test/golden/changes.md: every answer that differs from
//                                             /page5's, grouped by what the new data changed
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSite, loadCore } from "../test/golden/mapsma.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const SNAPSHOT = ROOT + "test/golden/mapsma.snapshot.jsonl";
export const ORIGINAL = ROOT + "test/fixtures/before/mapsma-page5";
export const FROZEN_PACK = ROOT + "test/fixtures/before/mx-sma-pack";
export const CURRENT = ROOT + "test/golden/mx-sma-current.snapshot.jsonl";

/** Every case: {key, turns}, for MapSMA's original files (a folder), "core" (domains/places with the pack as imported) or
 *  "current" (domains/places with packs/dist's San Miguel). */
export async function runAll(dir = ORIGINAL) {
  const site = dir === "core" ? await loadCore(undefined, "mx-sma", { src: FROZEN_PACK }) : dir === "current" ? await loadCore() : await loadSite(dir);
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

/** What the current pack answers differently from /page5, as Markdown: each changed case with both first sentences. */
export function changes(snapshot, current) {
  const a = snapshot.trim().split("\n").map((l) => JSON.parse(l)), b = current.trim().split("\n").map((l) => JSON.parse(l));
  const said = (t) => (t.answer?.say || []).map((s) => s.text).join(" ");
  const rows = [];
  a.forEach((x, i) => {
    const y = b[i];
    if (JSON.stringify(x) === JSON.stringify(y)) return;
    const k = x.turns.findIndex((t, j) => JSON.stringify(t) !== JSON.stringify(y.turns[j]));
    const ids = (t) => t.answer?.ids || [];
    const added = ids(y.turns[k]).filter((id) => !ids(x.turns[k]).includes(id));
    rows.push({ key: x.key, q: x.key.conversation[k], was: said(x.turns[k]), now: said(y.turns[k]), kind: y.turns[k].answer?.kind, added });
  });
  const byKind = rows.reduce((m, r) => ((m[r.kind] = (m[r.kind] || 0) + 1), m), {});
  const newIds = rows.flatMap((r) => r.added).reduce((m, id) => ((m[id] = (m[id] || 0) + 1), m), {});
  return { rows, text: [`# San Miguel's answers now, against /page5's`, "",
    `${rows.length} of ${a.length} cases answer differently from /page5 (18 Nov 2026) because San Miguel's pack has changed since it was imported`,
    `(\`packs/src/mx-sma\` against \`test/fixtures/before/mx-sma-pack\`). The code is the same: with the imported pack it gives /page5's answers exactly.`, "",
    `By kind of answer now: ${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(", ")}. Places newly in an answer: ${Object.entries(newIds).map(([k, n]) => `${k} ${n}×`).join(", ") || "none"}.`, "",
    "| Question | Clock | In | Was | Now |", "|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.q.replace(/\|/g, "/")} | ${r.key.clock} | ${r.key.lang} | ${r.was.slice(0, 160).replace(/\|/g, "/")} | ${r.now.slice(0, 220).replace(/\|/g, "/")} |`), ""].join("\n") };
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes("--current")) {
  const now = lines(await runAll("current"));
  if (process.argv.includes("--update")) {
    writeFileSync(CURRENT, now);
    const c = changes(readFileSync(SNAPSHOT, "utf8"), now);
    writeFileSync(ROOT + "test/golden/changes.md", c.text);
    console.log(`wrote ${CURRENT.slice(ROOT.length)}; ${c.rows.length} cases differ from /page5's (test/golden/changes.md)`);
  } else {
    const diff = differences(readFileSync(CURRENT, "utf8"), now);
    console.log(diff.length ? diff.join("\n") : "same as the current snapshot");
  }
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
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
