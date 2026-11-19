// Golden tests (plan step B0): MapSMA's reader and asker, as served on 18 Nov 2026, give exactly the recorded answers to
// the fixed questions (test/golden/questions-mapsma.json). Steps B2–B3 add the shared core to IMPLEMENTATIONS: it must give
// the same answers, case for case, before the site can switch to it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runAll, lines, differences, SNAPSHOT, ORIGINAL } from "../tools/golden.mjs";

const IMPLEMENTATIONS = [
  { name: "MapSMA /page5 as served on 18 Nov 2026", dir: ORIGINAL },
];

const snapshot = readFileSync(SNAPSHOT, "utf8");

test("the snapshot covers every question at every clock", () => {
  const cases = snapshot.trim().split("\n").map((l) => JSON.parse(l));
  const q = JSON.parse(readFileSync(new URL("./golden/questions-mapsma.json", import.meta.url), "utf8"));
  assert.equal(cases.length, q.conversations.length * (q.clocks.length + 1));
  assert.ok(cases.length > 1500);
});

for (const impl of IMPLEMENTATIONS) {
  test(`${impl.name} answers as recorded`, async () => {
    const diff = differences(snapshot, lines(await runAll(impl.dir)));
    assert.deepEqual(diff, [], diff.join("\n"));
  });
}
