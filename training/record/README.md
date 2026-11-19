# Recording the voice

The real voice behind the bilingual tiny-voca voice (`training/RECIPE.md`, step 4, option 1). One speaker reads about 500
short sentences, two in Spanish for every one in English, in four sessions. Those recordings are used three ways: a few
calm sentences let the teacher model copy the voice; all of them are mixed into the training audio, so the trained voice
learns the real accent and the real way San Miguel's names are said; and some are held back to test the result.

## Before the day

- **The speaker:** an adult who speaks Mexican Spanish natively and English comfortably. Their English accent is part of
  the voice; it does not have to sound American. They read and sign `CONSENT.md` first.
- **The room:** small, furnished and quiet: carpets, curtains, a sofa, a wardrobe of clothes. Not a kitchen or a bathroom.
  Fridge, fans, air conditioning and notifications off; windows shut; phones on silent.
- **The microphone, best first:** a USB microphone or a headset with a boom microphone; or a laptop's built-in microphone
  in a quiet room; or an iPhone on a stand (Safari, over https). Use the same one for every session, at the same distance:
  a hand's width (15–20 cm), slightly to the side of the mouth so breath does not hit it.
- **The page:** it must be opened over https or on `localhost` (browsers allow the microphone only there).
  - On a laptop: from the `tiny-speech` folder, run `python3 -m http.server 8000`, then open
    `http://localhost:8000/training/record/`.
  - Or on any device: deploy `tiny-speech/training/record/` with the rest of `/tiny-speech/` on mapsma.com and open
    `https://mapsma.com/tiny-speech/training/record/`. Nothing is uploaded from the page; recordings stay in that
    browser until they are downloaded.
- Water at room temperature; no dairy or coffee just before.

## On the day

1. Tick the consent box, turn on the microphone, and press **Check the room** with everyone silent for 5 seconds:
   under −50 dB is fine, under −60 dB is very good.
2. Record sentence 1 and read the checks under the buttons. Aim for a level between −18 and −3 dB. *Clipped* means move
   back or turn the input down (in the computer's sound settings); *too quiet* means come closer.
3. For each sentence: **Space** to start, wait half a second, read, wait half a second, **Space** to stop, then **Enter**
   to keep it and go on. **P** plays it back; **Space** again records it again (the new take replaces the old one);
   **←** goes back; **S** skips one the speaker cannot read naturally.
4. Read as if answering a friend's question: natural speed and warmth, the same energy all the way through. Spanish the
   way it is said in central Mexico; names of places the way people say them in San Miguel; numbers and times as written.
   A stumble: just record again.
5. A break every 15–20 minutes; the four sessions can be on different days. Sessions are in order of usefulness: if only
   one or two get done, those are the most valuable sentences.
6. After each session: **Download** its zip and keep a copy somewhere safe (it holds the speaker's voice: keep it private).
   About 5 MB a minute of speech at 48 kHz.

## Files

| File | What |
|---|---|
| `index.html`, `record.js`, `tap-worklet.js` | the recording page |
| `sentences.json`, `sentences.md` | the 650 sentences in order (`tools/pick-recording.mjs`), and a paper copy |
| `CONSENT.md` | the consent form, English and Spanish |

Each zip has `wavs/<id>.wav` (16-bit mono at the microphone's rate), `metadata.csv` (`id|lang|text|seconds|peak_db|snr_db|flags`)
and `info.json` (speaker code, consent, microphone and its settings, the room's noise). The GPU pipeline (`training/gpu/`)
reads them as they are.

The selection: the six Spanish and four English *reference* sentences come first (the teacher copies the voice from them);
then, two Spanish to one English, whichever sentence adds the most sounds, pairs of sounds and San Miguel name words not yet
recorded. The first 500 cover every Spanish sound pair in the 4,976-sentence script, 88% of the English ones, and every
word of San Miguel's place names.
