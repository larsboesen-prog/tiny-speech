# lang — language packs (plan step B6)

Everything about a language that is not about a city (D6): days, numbers and clock times, said and read.

| File | What |
|---|---|
| `en/index.js` | `sayTime`, `sayNum`, `clock`, `DAYNAMES` (MapSMA's, moved here unchanged); `readClock`, `numberOf` (new) |
| `es/index.js` | `sayTimeEs`, `sayNumEs`, `aTimeEs`, `showTimeEs`, `DIAS` (MapSMA's, moved); `readClock`, `numberOf` (new) |
| `es/mx.json` | Mexican Spanish: words (ahorita, al rato, mande, almuerzo, comida…), clock idioms, currency, sounds for the voice |

Rule: understand every variety's way of saying it, speak the city's (review 3.2). Spanish `readClock` reads Mexico's
"cuarto para las nueve" (8:45) and Spain's "nueve menos cuarto" alike. Every minute of the day that the voice says is read back as
the same minute, in both languages (`test/lang.test.mjs`).

Not yet wired into the reader: times like "at 9" do not change today's answers (MapSMA's reader has no clock times). Adding
them changes answers, so it comes as its own change with the golden snapshot's diff reviewed.

The language decision is `core/lang-decide.js`: Whisper's two-way English/Spanish score, the words with the city's names masked,
and the last question's language. On 419 labelled questions the words alone, names masked, choose right every time; without
masking, four English questions with Spanish names are taken for Spanish.
