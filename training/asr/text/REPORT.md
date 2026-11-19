# Restaurant requests, written down

3892 utterances by `tools/asr-text.mjs` (anthropic/claude-sonnet-5.5 through OpenRouter, each checked by rules; OpenRouter spending so far,
this repository: $7.32). About 4.4 hours if each is said once.

- Languages: es 3078, en 559, mixed 255.
- Kinds: requests 1109, corrections 551, followups 351, names 509, local 403, numbers 304, disfluent 205, music_drinks 205, mixed 255.
- Splits (by sentence): train 3342, test 369, dev 181. Test sentences are never synthesized for training; people record them for the test.
- 1170 name a San Miguel place (94 different places).

Examples:

- *requests* (es): ¿Dónde hay tacos cerca de aquí? — wants: tacos, nearby
- *corrections* (es): No, no, mejor de mariscos. — wants: seafood instead
- *followups* (es): ¿Y mañana? — wants: tomorrow's hours
- *names* (es): ¿A qué hora abre Tacos Don Tomás? — wants: opening time, taco place
- *local* (es): ¿Qué onda? ¿Dónde hay unos taquitos ricos ahorita? — wants: tacos, open now
- *numbers* (es): Una mesa para seis personas, por favor. — wants: table, party of six
- *disfluent* (es): Eh, tacos, este, tacos al pastor cerca de aquí. — wants: tacos al pastor, nearby
- *mixed* (mixed): ¿Dónde hay buenos tacos cerca de aquí? — wants: tacos, nearby
