// Golden tests (plan step B0): MapSMA's reader and asker, as served on 18 Nov 2026, give exactly the recorded answers to
// the fixed questions (test/golden/questions-mapsma.json). Steps B2–B3 add the shared core to IMPLEMENTATIONS: it must give
// the same answers, case for case, before the site can switch to it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runAll, lines, differences, SNAPSHOT, ORIGINAL, CURRENT } from "../tools/golden.mjs";

const IMPLEMENTATIONS = [
  { name: "MapSMA /page5 as served on 18 Nov 2026", dir: ORIGINAL },
  { name: "the shared core (domains/places) with San Miguel's pack as imported", dir: "core" },
];

const snapshot = readFileSync(SNAPSHOT, "utf8");

test("the snapshot covers every question at every clock", () => {
  const cases = snapshot.trim().split("\n").map((l) => JSON.parse(l));
  const q = JSON.parse(readFileSync(new URL("./golden/questions-mapsma.json", import.meta.url), "utf8"));
  assert.equal(cases.length, q.conversations.length * (q.clocks.length + 1));
  assert.ok(cases.length > 1500);
});

// The core may differ from /page5 only where test/golden/approved.json says so, case by case, with the reason; /page5 itself never.
const APPROVED = JSON.parse(readFileSync(new URL("./golden/approved.json", import.meta.url), "utf8")).approved;
function unapproved(expected, actual, approved = APPROVED) {
  const a = expected.trim().split("\n"), b = actual.trim().split("\n"), ok = new Set(approved.map((x) => JSON.stringify(x.key)));
  const bad = [], used = new Set();
  a.forEach((line, i) => {
    if (line === b[i]) return;
    const key = JSON.stringify(JSON.parse(line).key);
    if (ok.has(key)) used.add(key); else bad.push(key);
  });
  return { bad, stale: [...ok].filter((k) => !used.has(k)), sameCount: a.length === b.length };
}

for (const impl of IMPLEMENTATIONS) {
  test(`${impl.name} answers as recorded${impl.dir === "core" ? " (except the approved differences)" : ""}`, async () => {
    const now = lines(await runAll(impl.dir));
    if (impl.dir !== "core") {
      const diff = differences(snapshot, now);
      return assert.deepEqual(diff, [], diff.join("\n"));
    }
    const { bad, stale, sameCount } = unapproved(snapshot, now);
    assert.ok(sameCount, "the number of cases changed");
    assert.deepEqual(bad, [], `${bad.length} differences not in approved.json:\n` + differences(snapshot, now).join("\n"));
    assert.deepEqual(stale, [], "approved.json lists cases that no longer differ: remove them");
  });
}

test("an approved difference passes, an unlisted one fails, a stale approval fails", () => {
  const row = (key, say) => JSON.stringify({ key, turns: [{ answer: { say: [{ text: say }] } }] });
  const was = [row({ q: 1 }, "a"), row({ q: 2 }, "b")].join("\n"), now = [row({ q: 1 }, "A"), row({ q: 2 }, "b")].join("\n");
  assert.deepEqual(unapproved(was, now, [{ key: { q: 1 }, why: "test" }]).bad, []);
  assert.deepEqual(unapproved(was, now, []).bad, [JSON.stringify({ q: 1 })]);
  assert.deepEqual(unapproved(was, was, [{ key: { q: 1 }, why: "test" }]).stale, [JSON.stringify({ q: 1 })]);
});

test("the shared core with San Miguel's current pack answers as last re-recorded (test/golden/changes.md says what differs from /page5)", async () => {
  const diff = differences(readFileSync(CURRENT, "utf8"), lines(await runAll("current")));
  assert.deepEqual(diff, [], diff.join("\n") + "\n(re-record on purpose: node tools/golden.mjs --current --update)");
});
