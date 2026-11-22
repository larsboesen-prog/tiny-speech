// The word list for the ears probe (README.md here): San Miguel's, as tools/ears-lexicon.mjs builds it for the tiny ears (every word of
// the training-split restaurant requests and of the pack, with its sounds, and the training split's word pairs).
// node training/asr/probe/lexicon.mjs <out.json>
import { writeFileSync } from "node:fs";
import { earsLexicon } from "../../../tools/ears-lexicon.mjs";

// The probe's measurements (README.md here) were made with the list as it was before 22 Nov 2026: {extended: false} keeps it.
const { words, unigrams, bigrams, summary } = await earsLexicon("mx-sma", { extended: false });
writeFileSync(process.argv[2], JSON.stringify({ words, unigrams, bigrams }));
console.log(summary);
