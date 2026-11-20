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

**Next, if the ears come off hold:** (1) train a tiny sound recognizer to imitate this one (its outputs on Common Voice
Spanish and English and our synthetic clips are free labels) and rerun this probe with it; (2) record 5–10 real Mexican
speakers and rerun both. Ship only if the tiny one still beats Whisper tiny on real speakers.

Run: `node training/asr/probe/lexicon.mjs lexicon.json`, then
`python probe.py --manifest <clips.jsonl> --split dev --lexicon lexicon.json --out heard/probe.jsonl --lm 0.5 1 2 --bonus 0 1.5 3`
(Python with torch and transformers; the recognizer downloads once, 1.2 GB), then `node tools/asr-eval.mjs heard/*.jsonl`.
