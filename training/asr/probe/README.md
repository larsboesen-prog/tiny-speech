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

**Next, if the ears come off hold:** (1) train a tiny sound recognizer to imitate this one (its outputs on Common Voice
Spanish and English and our synthetic clips are free labels) and rerun this probe with it; (2) record 5–10 real Mexican
speakers and rerun both. Ship only if the tiny one still beats Whisper tiny on real speakers.

Run: `node training/asr/probe/lexicon.mjs lexicon.json`, then
`python probe.py --manifest <clips.jsonl> --split dev --lexicon lexicon.json --out heard/probe.jsonl --lm 0.5 1 2 --bonus 0 1.5 3`
(Python with torch and transformers; the recognizer downloads once, 1.2 GB), then `node tools/asr-eval.mjs heard/*.jsonl`.
