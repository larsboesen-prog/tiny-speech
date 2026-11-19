# domains/music: live music nights (plan step B8, D5)

`index.js` reads a music question (genres in English and Spanish, tonight / now / tomorrow / a weekday) and answers it from
the city pack's `music` table, which the builder takes from the city's optional `music.json` and ships in the live file
beside the hours. `domains/places/ask.js` asks it first, only when the pack has music nights; any other question, and any
city without music data, is answered exactly as before.

- Genres: `GENRES` (17). A new genre is a line here, then it may be used in a city's `music.json` (the builder checks).
- "Salsa" alone is a sauce; the genre needs "bailar salsa", "salsa night" and the like. A question asking for a quiet place
  without loud music is not a music question.
- Freshness: an answer says when the list was last checked if that was over 60 days ago; the build warns as well.
- Tests: `test/music.test.mjs` (Villa Ejemplo's test nights; San Miguel's template).
