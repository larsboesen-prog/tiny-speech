# The ears probe (19 Nov 2026)

**Question:** the owner wants bilingual ears of 8–10 MB for restaurant and event questions. Whisper tiny cannot be that small
(39M parameters). The design that can: a small recognizer of *sounds* plus matching against a word list built from the
city's data (the Snips / Sonos pattern). Before building or training anything: does the design work at all? This probe uses
a large sound recognizer (wav2vec2-lv-60-espeak-cv-ft, 300M parameters, Spanish and English sounds) as the best case.

**How:** `lexicon.mjs` builds the word list (2,181 words from the training-split restaurant requests and San Miguel's pack;
Spanish sounds by our rules, English by tiny-voca's dictionary; 12,084 word pairs for which word follows which). `probe.py`
matches the recognizer's sound probabilities to it (a CTC beam search kept to the word list, with the word-pair model).
Clips: the 144 held-out synthetic Mexican Spanish requests (Piper's two voices) that stock Whisper tiny was measured on.
Settings chosen on the first 72 clips (9 tried), measured on the other 72.

| On the 72 held-out clips | Words wrong | Places found | Understood as said | Language right |
|---|---|---|---|---|
| Whisper tiny, as the sites use it, no hint | 47.7% | 6 of 12 | 29.2% | 97.2% |
| Whisper tiny, hint + guard | 43.1% | 6 of 12 | 30.6% | 94.4% |
| **Sounds + word list (probe)** | **39.8%** | **9 of 12** | **47.2%** | 80.6% |

On all 144 clips: understood as said 50.7% (Whisper 34.7%, with hint + guard 36.1%); words wrong 42.6% (41.1%, 38.7%);
places found 19 of 32 (20, 19); language right 87.5% (98.6%).

**What it says:** the design understands clearly more requests than the sites' Whisper tiny (+17 points on held-out clips),
because the word list keeps the hearing on the app's own words ("dame opciones para desayunar algo con chilaquiles" came out
exactly). Its weak spots are visible: 10 of 144 answers came out empty (the search lost every complete path: fixable), and
the language is decided worse (English words in the list get picked: give the language its own say, e.g. from the sounds).

**What it does not say yet:** this is the best case. The sound recognizer here is 300M parameters; the 8–10 MB version would
be a small model (5–8M) trained to imitate it, and how much it keeps is the open question. The word list comes from text
written in the same style as the test sentences (real people will use words outside it), and the voices are synthetic.

## What moves the success rate (20 Nov 2026)

Each change below was tried on the cached sound outputs, chosen on the first 72 clips and measured on the other 72 (one clip
is 1.4 points, so ±1–2 clips is noise).

| Matcher | Understood, held-out 72 | Tuning 72 |
|---|---|---|
| As first run: 48 paths kept | 34 (47.2%) | 39 |
| + when no path ends on a whole word, keep the finished words (no more empty answers) | 35 | 40 |
| + 128 paths kept | 40 | 42 |
| **+ 256 paths, sounds within 10 log points tried (now `probe.py`'s defaults)** | **42 (58.3%)** | 44 |
| 512 paths | 43 | 44 (no better: not worth twice the time) |

At 256 paths, held-out: words wrong 32.7%, places 10 of 12, language right 93.1% (Whisper tiny: 43–48%, 6 of 12, 94–97%,
understood 29–31%). Matching takes about 0.4 s per request in Python on this CPU.

**Not drivers here** (each within noise): the test sentences' words added to the list (+1); the language known before
matching (Spanish-only list, +1); matching once in Spanish and once in English and keeping the better (picked Spanish on all
144 clips, so the language can come from the sounds, but understanding did not change; English clips not tested); a
three-word model (+1 at weight 0.5, worse at 1.0); a bonus for the 487 words the reader acts on (no gain, worse when strong);
a quarter, half or all of the training sentences for the word-pair model (37, 39, 40: more of the same text flattens out);
the top 5 guesses instead of the best (+1 held-out, +3 tuning): they hold 1.4 different requests on average, so a "did you
mean" list from the matcher would rarely offer the right one.

**What is left is the sounds.** Of the 30 held-out failures at 256 paths, 28 have every word in the list: the sounds
pointed to other words (frío → fino, perro → pero, dulce → doce). The thing asked for is lost in 17 of 30; 13 of 30 differ
in one part only. The voice alone moves it 8 points (Piper claude-high 46 of 72, ald-medium 40 of 72). So the 8–10 MB
result will be decided by how well the small sound model hears, and by real speakers, not by the matcher or the text.

## An outside review's ideas, measured (20 Nov 2026)

Same discipline: chosen on the first 72 clips, reported on the other 72 (held-out at 256 paths: 42 of 72 understood).

- **The three example errors are the teacher's own hearing**, not the matcher's: its sounds for "perro" were `p e ɾ o`
  (one tap), for "frío" `f i l o`, for "dulce" `d u s e`. A student that only imitates it inherits them, so the tiny ears
  now also learn from the transcripts of the Spanish speech (`../../ears/`, the CTC on what was said).
- **Pronunciation variants learned from the teacher's confusions** (`confusions.py`, `probe.py --rules`): on the tuning half
  the teacher drops ɾ 31% of the time and hears it as r 25%, d as ð, j as i, b as v. Adding the top rules as costed variants:
  best on tuning +1 clip (noise), and on held-out **37 of 72 instead of 42: worse**. The variants make words sound alike and
  fill the search with near-duplicates. Not used; worth retrying with the tiny ears' own confusions.
- **Boosting the reader's words** (487): no gain (above). **Top 5 guesses**: 1.4 different requests on average (above).
- **Asking again when unsure**: whole-request confidence separates right from wrong only weakly on held-out clips (area
  under the curve 0.64–0.67; 0.81–0.86 on the tuning half). Asking again for the least sure ~20% raises the share answered
  right from 58% to 56–63%. Not worth a question yet; retry with per-part confidence and the tiny ears.
- **The ends of questions**: the sites already keep 250 ms before and 300 ms after the speech. MapSMA's 8 s limit would cut
  about 1–2% of these requests; CredBrief's 5 s about 40% (the owner's choice, for short news questions).
- **The measure that matters** is now in `tools/asr-eval.mjs`: **the thing asked for heard right** (the dish, drink or kind
  of place). Held-out: **probe 33 of 52 (63.5%)**, Whisper tiny 12 of 52 (23.1%), with hint + guard 12 of 52.
- Not taken up: collecting real failed searches' audio (the sites keep audio on the phone by design; real speech comes only
  from people who consent on the recording page); a tiny verification model per word pair and two passes with different
  audio cleaning (no evidence yet that they pay; each costs time on the phone).

**The tiny ears (20 Nov 2026, `../../ears/README.md`):** the 8.9 MB student, with this matcher unchanged (`--onnx`),
understood **80.6%** of the 72 held-out clips (thing asked for 46 of 52, words wrong 8.8%) and **85.4%** of the 144 sentences read
by two voices it never heard (teacher 65.3%, Whisper tiny 52.1%): it beats its teacher because it also learned from transcripts.

**Next, if the ears come off hold (done: step 1):** (1) train a tiny sound recognizer to imitate this one (its outputs on Common Voice
Spanish and English and our synthetic clips are free labels) and rerun this probe with it; (2) record 5–10 real Mexican
speakers and rerun both. Ship only if the tiny one still beats Whisper tiny on real speakers.

Run: `node training/asr/probe/lexicon.mjs lexicon.json`, then
`python probe.py --manifest <clips.jsonl> --split dev --lexicon lexicon.json --out heard/probe.jsonl --lm 0.5 1 2 --bonus 0 1.5 3`
(Python with torch and transformers; the recognizer downloads once, 1.2 GB), then `node tools/asr-eval.mjs heard/*.jsonl`.

## Names by sound (22 Nov 2026)

The owner, after the English retrain: "it still fails on place names said with an accent. 'Estoril' is not recognised
at all. 1. Match place names by sound… ('a story', 'es to real' → Estoril). No retraining. 2. Ask when unsure… One tap picks the
place." Matching the written guess against the names loses too much: the matcher has already turned "Estoril" into "is it" or "a
stroll". So `engines/ears-spot.js` looks for each of the city's names in the ears' **sounds** (the 20 ms frames, before words are
chosen): the best stretch of the recording where the name's sounds could have been said (Viterbi over the name's CTC states, the rest
of the recording heard freely), scored as the cost per sound against hearing the whole recording freely. Readings come from the same
word list (every word's Spanish and English sounds, and the soft b/d/g/y heard hard); the names and their other spoken forms from
the pack (`packs/dist/<city>/ears-names.json`, written by `tools/ears-lexicon.mjs`). 634 readings of 99 of San Miguel's 100 names;
12–22 ms per question in Node, 21 ms in the browser worker. `soundChoice` decides: the sounds speak only when the words named no
place in a question shaped like one about a place ("Is X open?", "X, when is it open?", "¿Está abierto X?"); a clear winner (at
most 2.5 per sound, the next name 1.0 further) answers; otherwise the names within 1.0 of the best (best at most 3.0) are offered as
buttons, under the list when the question also asked for a kind of place; on the English page a name the words found but the sounds
clearly contradict (by 1.5) is offered beside the sounds' choice.

**Test sets.** Not the owner's voice yet (record-names/ and `tools/names-test.mjs` measure that): `accent_synth.py` has five
foreign-language Piper voices (Danish talesyntese, German thorsten, Swedish nst, French siwis, Belgian Dutch nathalie) and two English
ones (US ryan, GB alan) read "Is X open?" and "X, when is it open?" for the 40 names of record-names/names.json: 560 clips. Their
frames as /page5 hears them (`page_path.py`: 48 kHz, then listen.js's to16k; the same results as the clean 16 kHz files, 402 vs 401).
Controls: the 201 English requests and 90 everyday English questions, and the 288 Spanish requests (Mexican and unheard voices) and
80 everyday Spanish ones, as before. `names_eval.mjs` gives the numbers; the settings were chosen among 2,880 as those adding no wrong
answer on any set.

| 560 accented clips (English page) | Names found before | After | + offered as buttons | A wrong place before → after |
|---|---|---|---|---|
| all | 370 (66%) | **402 (72%)** | 81 (found or one tap: **483, 86%**) | 14 → 10 |
| Danish (talesyntese) | 31 of 80 | 37 | 19 | 3 → 2 |
| German (thorsten) | 39 | 44 | 18 | 1 → 1 |
| Swedish (nst) | 63 | 67 | 7 | 2 → 2 |
| French (siwis) | 42 | 47 | 19 | 4 → 3 |
| Belgian Dutch (nathalie) | 54 | 61 | 12 | 2 → 0 |
| US English (ryan) | 74 | 76 | 0 | 1 → 1 |
| British English (alan) | 67 | 70 | 6 | 1 → 1 |

| Controls | Names found before → after | A wrong place | "Did you mean" under answers to questions naming no place |
|---|---|---|---|
| English, 291 clips (114 name a place) | 94 → 101 | 1 → 1 | 4 of 177 ("where's the best mezcal bar in town": San Mezcal, under the list) |
| Spanish, 368 clips (96 name a place) | 72 → 73 | 3 → 3 | 0 |

The rest of the misses: the sounds' best name is wrong (Lavanda heard as Bennu), or nothing is close. Through Chromium's fake
microphone the Danish "Is Estoril open?" scores 2.2 (2.1 from the file), which is why the answer limit is 2.5, not the 2.25 that
gave the same results here. `tools/names-test.mjs` runs the same before/after on a recorded set through the browser worker: the
Danish stand-in's 40 "Is X open?" 17 → 22 found, 12 more offered (34 of 40 found or one tap away).

## Learning from picks (22 Nov 2026)

The owner: "Will model learn and further improve from did you mean selection?", then "build option 1" (the phone remembers, nothing
leaves it). When the visitor picks a name among "Did you mean", the ears read how that name sounded in that question
(`heardAs`: the frames where the name's best placement lies, each frame's best sound, repeats and blanks dropped: "Is Estoril open?"
from the Danish voice gives `ɛ s t ɹ ʊ l`-like sounds) and keep it as one more reading of the name (`learn`; the latest three per
name). /page5 keeps them in localStorage and gives them back to the ears on every visit; Voice settings can forget them. Sounds
only, never audio. One rule was added with it: a question not shaped like one about a place answers about a name only when it is very
clear (at most 1.0 per sound, 1.5 ahead of the next); without learned readings no name gets that clear (402 found on the accented set
with or without the rule, the controls unchanged), but a learned one does.

`learn_eval.mjs` simulates it on the accented stand-in set: each voice asks "Is X open?" for the 40 names; where the page offers the
right name as a button, the visitor taps it and the ears learn; then the same voice asks "X, when is it open?" (another sentence, so
the name is heard in other surroundings). And the 291 ordinary English questions with each voice's learned names in place.

| 7 voices × 40 names, "X, when is it open?" | Names found | + offered as a button | A wrong place |
|---|---|---|---|
| Names by sound, nothing learned | 192 of 280 | 39 | 4 |
| **After learning from the taps on "Is X open?" (42 names learned)** | **211** | 28 | 4 |
| After learning from every "Is X open?" not answered right (70) | 216 | 29 | 3 |
| … Danish voice: from taps (12 learned) | 15 → 20 of 40 | 7 → 6 | 0 |
| … French voice (11 learned) | 24 → 29 | 8 → 6 | 2 → 2 |

Ordinary questions with every voice's learned names: no new wrong answer, no new "Did you mean", none lost. Through the browser
worker (`tools/names-test.mjs` on the Danish voice's 80 questions as a recorded set): second takes 16 → 20 of 40 after 12 picks.
The same question asked again after a pick is answered at once (`mapsma/test/page5-names.test.mjs`: Casa Nostra 2.1 → 0.13 per sound).
The rest: a name heard very differently in the two sentences (Tostévere as "is that open" and "does the one is it open"), or a learned
reading that took in a neighbouring sound ("la shop o…" for La Chope).

## Restaurants, streets and hotels (22 Nov 2026)

The owner: "Some new variations fail: show me some high end restaurants, … restaurants on umaran, show me some quality restaurants.
Show me rooftop restaurants is translated as show me rooftop esta … Show me restaurants in live aqua is shown as show me están sin
light … You should be able to run English test and see what's written and improve". Three causes, in this order:

1. **The reader**, given the right words: streets were not understood ("on Umarán" read as Café Umarán), nor "quality", nor hotels.
   Now a place's street is the first part of its address (`domains/places/streets.js`; /page5's copy in its read.js): a question names
   one after "on", "along", "calle", "en la calle" or before "street", and the answer lists the places on it ("2 places on Umarán";
   "Is Café Umarán open?" is still the café). "Quality" counts as "best". /page5 also knows five hotels from its data: near the
   Rosewood, the Belmond, Casa Blanca 7 or El Golpe de Vista (the places inside them, then the nearest); Live Aqua has no places on
   MapSMA, so "in Live Aqua" says so and shows the nearest to its pin (20.919975, -100.739347, from the owner's Google Maps link).
2. **Words missing from the list**: the streets (40, from the addresses), "aqua", "rosewood", "quality". Now in the list, the
   streets and hotels with a Spanish and an English reading (an English speaker says "Hernández Macías" the English way; on the
   Spanish page the English reading costs as other English does), with example questions in the word pairs at a small weight ("show
   me some {quality, high end, rooftop, Italian…} restaurants", "restaurants on {street}", "restaurants near {hotel}").
3. **"Restaurants" heard as Spanish words** ("está", "están", "es town"): its only reading was the American one. On the English page,
   every English word now also has its spelling read by Spanish rules at a cost of 1 (`restawɾants`), as many non-native speakers say
   it closer to the letters.

Test sets: `list-questions.json` (24 questions about restaurants, streets, hotels and qualities) read by the 7 stand-in voices
(`voices_synth.py`, 168 clips), and `list-questions-heldout.json`, 16 other questions written after the changes were chosen, read
by those 7 and 3 more (Italian, Polish, Brazilian Portuguese; 160 clips). Measured with `list_eval.mjs`, through the page's audio path;
"request right" = the reader gets the same request from the heard words as from what was said (with the new reader for both columns).

| | Old list | Streets, hotels, list phrasing | **+ spelled readings (shipped)** |
|---|---|---|---|
| 168 list questions: request right | 31.5% | 42.9% | **47.6%** |
| … written exactly; words wrong | 11.9%; 57.8% | 20.8%; 50.6% | 25.0%; 45.5% |
| … the two native voices (request right, of 24 each) | 13, 15 | 19, 19 | 19, 19 |
| **160 held-out questions: request right** | 19.4% | | **35.0%** |
| … the two native voices (of 16 each) | 7, 6 | | 12, 9 |
| 201 English requests / 90 everyday English: request right | 180 / 85 | 181 / 85 | 181 / 85 |
| Spanish page: 144 Mexican / 144 other voices / 80 everyday: request right | 134 / 122 / 70 | 134 / 123 / 70 | (English page only) |
| 560 accented name questions: names found (with names by sound); a wrong place | 402; 10 | | 402; 12 |

The accented stand-ins stay hard: Piper's Danish, German, French… voices read English text by their own spelling rules ("restaurants"
as "res toros", "es town"), further from English than a real accent; the owner's own recordings (record-names/) are the better test.
Left for later: native English voices still say some Spanish street names in ways the list misses ("Insurgentes" as "in since",
"Macías" as "macha"). A first try that gave streets and hotels the English reading at no cost on the Spanish page too, with "the
rosewood" in the hotel words, put "the" into Spanish questions ("está me the last eh" for "¿Está abierta La Azotea?"): short words and
the Spanish page's English readings are now kept out.

## The owner's own voice (22 Nov 2026)

The owner recorded the 40 names twice (record-names/: "Is X open?", then "X, when is it open?"; 80 questions, 0.8–3.1 s, through the
phone's microphone as /page5 records it) and handed the file over; it stays out of the repository (a test set, never training).
`tools/names-test.mjs` heard it with the live model in Chromium, through the page's worker, the English page's word list:

| 80 questions, English page | Names found | + offered as a button | Found or one tap away | A wrong place |
|---|---|---|---|---|
| Words only (before update 5) | 55 (69%) | | 55 (69%) | 1 |
| Names by sound, update 6's rules | 58 (73%) | 5 | 63 (79%) | 1 |
| **+ the shapes this voice showed (update 7)** | **58 (73%)** | **16** | **74 (92.5%)** | **1** |

Learning from picks: 8 names were offered as buttons on the first round; learned from those taps, the second round found 31 of 40
(30 without; 32 if every miss on the first round were corrected).

What the voice showed: the sounds usually knew the name ("pisco open": Birria Xalisco 0.62 per sound, the next 2.36), but the page
did not act, because the words no longer looked like a question about one place: "X, when is it open?" came out "… when is el", "… when
is it", "… a when" (9 of 10 misses on the second round), and "Is X open?" as "X open" ("say open", "cava open", "el been open"). Now a
question ending in "when (is it/el)", or of at most four words ending in "open" with nothing else asked, counts as one about a place
(`ONE_PLACE_LOOSE`). Found while looking at this set, so its gain here is optimistic; on the other sets it changed nothing for the worse
(560 accented: 402 found, buttons 81 → 86, wrong 12; English and Spanish controls the same). Two more rules from the same look: "where
is a/an/some …" asks for a kind of place, not a name ("Where is a quality steak restaurant?" had picked The Restaurant), and a question
naming a street or a hotel keeps its list, the names only offered under it (held-out list questions: wrong places 6 → 4, "Did you mean"
rows 20 → 16).

Still missed (6 of 80): "Is Café Umarán open?" heard "me a" (nothing close), "Agavia, when is it open?" (Kan Bei first), "Bocaciega,
when is it open?" heard "pocas y que es el" (no shape), "Is Birria Xalisco open?" heard "pisco open" (pisco is a drink: a list), "Is
Hierba Santa open?" heard "sí a sana" (healthy food: a list), "Parque Juárez, is it open now?" heard "tacos is it open now". One wrong
place: "Is La Cabra Iluminada open?" heard "is la colmena a pho" → Panadería La Colmena (the words named it).

### The six still missed, fixed (22 Nov 2026, the owner: "First propose fix to correct 6 misses", then "Yes to all")

Their raw sounds showed one pattern: the owner's **b, d, g come out as p, t, k** ("Birria" as `p i r i a`, "Bocaciega" as `p o k e…`),
as Danish (and German, Dutch) speakers say them, and a written v as v ("Agavia" as `k a v i…`, not `aɣaβja`). What changed:

1. **Name readings without voice, and with v and i** (`engines/ears-spot.js`: b/d/g → p/t/k, β → v, j → i), for names of at least 5
   sounds, searched only for the 20 names closest with the plain readings (about 37 ms for a 3-second question in Node). For every
   name, they made short ones look like everyday words (Bennu as "p e n u", the end of "open": second in every "… open?") and cost 13
   direct answers on the accented set; at 5 sounds and more they cost none. An extra cost on these readings (0.2–0.5 per sound) was
   tried too: it undid most of the owner's gains (3 of 6 instead of 5).
2. **A short question that is mostly a name** (at most 3 words, at most 0.6 per sound, 1.2 ahead of the next) is answered even when the
   words do not look like a question about a place or picked up a food word ("pisco open" → Birria Xalisco, "sí a sana" → Hierba
   Santa). First tried at 5 words, 1.0 and 1.0: it answered "What vegan restaurant is open?" with The Restaurant (5 wrong on the
   controls), so it was tightened until none of the controls changed.
3. **The words named one place, the sounds very clearly another** (at most 1.0 per sound, 1.0 better), on either page: both are
   offered ("is la colmena a pho": La Cabra Iluminada or Panadería La Colmena).
4. English readings for every place name in the word list: no gain on the owner's set, 3 fewer names on the 201 English requests;
   **not kept**.
5. **Half a second kept before the detected speech** (was a quarter) in /page5's listener and the recorder: "Is Café Umarán open?" was
   recorded as 1.0 s with only "…marán" left. Not measurable on this set (the cut sound is gone).

| | Update 7 | **With 1–3 (and 5)** |
|---|---|---|
| The owner's 80: found / + buttons / found or one tap / wrong | 58 / 16 / 74 / 1 | **61 / 18 / 79 / 0** |
| … second round after learning from the first round's picks | 31 of 40 | 32 of 40 |
| 560 accented stand-ins: found / + buttons / wrong | 402 / 86 / 12 | **404 / 86 / 9** |
| 201 English requests, 90 everyday English: names found / wrong | 90 / 1; 11 / 0 | the same |
| 328 list questions: wrong places | 8 | 8 |
| Spanish page, 368 clips: found / + buttons / wrong | 72 / 2 / 3 | 71 / 4 / 3 |

All of 1–3 were found on the owner's set; the recorder now has a third round (the other 60 places, once) to check them on names
never looked at while tuning.
