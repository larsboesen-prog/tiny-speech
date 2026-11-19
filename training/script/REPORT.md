# The bilingual voice's training script: coverage

Written 2026-11-19 by `tools/script-report.mjs`. Sentences by Claude Sonnet 5.5 through OpenRouter
(`tools/make-script.mjs`, $3.28), each checked by rules before it was kept.

## Mexican Spanish (`es-mx.jsonl`)

3580 sentences, 43544 words, about 4.48 hours of speech. Themes: answers 296, questions 301, music 301, hours 297, directions 300, food 299, numbers 300, news 299, replies 291, places 300, mixed 295, names 301.

- Sounds (lang/es/ipa.js's 29): all present.
- Stressed vowels: ˈa 9088, ˈe 8099, ˈi 4717, ˈo 4714, ˈu 1496.
- 469 different pairs of sounds.
- Sounds seen under 100 times: ʃ 7.

| Sound | Count |
|---|---|
| a | 28213 |
| e | 25145 |
| s | 16542 |
| o | 16413 |
| n | 12026 |
| ɾ | 9674 |
| l | 9337 |
| t | 8883 |
| i | 8727 |
| k | 7666 |
| m | 5892 |
| d | 4960 |
| p | 4518 |
| j | 4098 |
| u | 3487 |
| ð | 3297 |
| β | 2513 |
| w | 2435 |
| b | 2043 |
| ʝ | 1461 |
| f | 1440 |
| x | 1341 |
| r | 1331 |
| ɣ | 1224 |
| tʃ | 1147 |
| ŋ | 720 |
| ɡ | 700 |
| ɲ | 414 |
| ʃ | 7 |

## English (`en.jsonl`)

1396 sentences, 15905 words, about 1.64 hours of speech.
59 of tiny-voca's phones used; 1909 different pairs of sounds.
Phones seen under 30 times: ʔ 2, n̩ 2, aɪɚ 13.
Themes: answers 200, questions 200, music 200, hours 198, directions 200, news 200, replies 198.

## What this is for, and what it is not

These sentences are what the one bilingual voice must say well: the app's own answers, questions, hours, directions, dishes,
numbers and San Miguel's names, in Mexican Spanish and English. Training also needs general speech (upstream tiny-voca read
17.6 hours, mostly LibriTTS-R and Common Voice sentences); the script adds the app's domain, in Spanish first. See
`training/RECIPE.md` for the steps that remain (a teacher voice to read it, then training on a GPU).
