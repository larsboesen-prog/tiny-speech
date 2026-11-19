# San Miguel de Allende (mx-sma): pack source

Imported on 19 Nov 2026 by `tools/import-mapsma.mjs` from MapSMA /page5 as served on 18 Nov 2026; edit these files by
hand from now on (they are data: review changes as diffs), then run `node tools/build-pack.mjs mx-sma`.

| File | What |
|---|---|
| city.json | time zone, centre, distances, meal hours, kinds of place, how answers name the city |
| areas.json | neighbourhoods and the centre: the words a question uses, what a place's area says |
| places.json | 100 places: /page5's 96, and four live music venues added on 19 Nov 2026 (X19–X22); names people say, facts, info, the sentence name of a sight, the recognizer hint |
| collections.json | Susan York's picks (8) and how answers name them |
| hours.json | opening hours, one source, with checked dates where known |
| lexicon.json | English words inside names, hand-written readings |
| music.json | live music nights (D8), with how to fill it in at the top: three venues' nights from web listings (dated by the listing, so answers say "worth confirming"), five venues waiting for theirs |

Known faults carried over from /page5 on purpose (the golden snapshot records today's answers; fix them as separate changes):

- **Aliases lost to a comment.** In read.js, the line with Jacques' aliases continues with a `//` comment that swallows the aliases of
  places 8, 9, 13, 20, 22 and 28 (umaran; kibok, key bok; buon forno; andys tacos, andys taco; don tomas; la mancha). They are not
  in places.json yet.
- **Two sources of hours.** /photos/hours.json has 54 places; 45 of them are also in data.js, and for 20 of those the two
  disagree (1, 2, 9, 10, 34, 39, 43, 45, 50, 52, 54, 58, 60, 62, 67, 72, 74, 76, 80, 81); 9 are only in hours.json. hours.json was used (as the page does); data.js's version is kept as
  `alsoSaid` beside each disagreement until settled, and the build report lists them.
- **INFO without a place:** 4, 5, 6, 7, 12, 14, 19, 26, 30, 36, 37, 40, 41, 44, 56, 57, 63, 64, 79.

**Since the import.** The code is checked against /page5 with the pack as imported (`test/fixtures/before/mx-sma-pack`); what
this pack answers now is recorded separately (`test/golden/mx-sma-current.snapshot.jsonl`), and every answer that differs
from /page5's is listed in `test/golden/changes.md`. After changing these files: `node tools/build-pack.mjs mx-sma`, then
`node tools/golden.mjs --current --update`, and read the changes.

- 19 Nov 2026: Mama Mía (X19), Raindog Cantina (X20), Johnny's Piano Bar (X21) and Casa Europa (X22, a sight) added from
  web listings, each with its source; positions from neighbouring places on the same street (`acc`: `address` or
  `street`); Johnny's hours from a listing; Mama Mía's and Raindog's hours not found. 181 of 1,756 recorded answers
  changed: 56 music questions now answered from the music nights, and 125 lists that hold the new places further down.
