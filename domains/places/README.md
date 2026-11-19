# domains/places — places to eat, drink and see, for any city

`read.js` (words → request) and `ask.js` (request → answer) are MapSMA /page5's files of 18 Nov 2026 with every San Miguel
value moved into the city pack (plan steps B2–B3, 19 Nov 2026). Compare them with the originals to see exactly what changed:

```
diff ../../test/fixtures/before/mapsma-page5/read.js read.js
diff ../../test/fixtures/before/mapsma-page5/ask.js ask.js
```

What moved to the pack (`packs/src/<city>/`): place names, other names and exact-only names; areas and the centre's words; the
curated list (Susan York's picks) with its words, count, kinds and wording; the time zone; the centre, its radius and how far
"near me" may be; walking speed; meal hours; the sights' sentence names; how answers name the city and its centre.

What stayed in code, city-free: the grammar of a question (times, counts, prices, near, list or one, "more", days), the topics
(cuisines, dishes, features: Mexican-flavoured today; a variety table later, step B6), opening-hours logic, ranking and the
English and Spanish sentences.

```js
import { createAsker, nowAt, requestOf } from "./ask.js";
const asker = createAsker({ pack, lang: "es" });           // pack: core/pack/assemble.js's object
const res = asker.answer("¿qué hay abierto para cenar?", nowAt(pack.tz), lastList, here);
```

The request field `collection` (any city's curated list) is MapSMA's `susan`; the golden tests rename it back to compare.
Tests: `test/golden.test.mjs` (434 questions, identical to MapSMA) and `test/core-places.test.mjs` (no city in the code; the city
comes from the pack).
