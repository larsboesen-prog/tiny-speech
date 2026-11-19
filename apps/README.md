# apps: one small config per site (plan step B9)

The top layer (ARCHITECTURE.md section 2): what a site uses the core for. Nothing below this folder names a site or a host;
the workers take their cache names from the address the page builds from its config (`core/config.js`, `workerUrl`).

| Key | What |
|---|---|
| `caches` | Cache Storage names: `libs` (engine files), `voice` (ONNX voice, + model and dizione revisions), `voiceJs` (plain-JS voice, + model revision), `packs` (city packs). MapSMA's and CredBrief's are the names their pages used before the shared core, so a visitor's stored files are found again. |
| `voice` | `dizione`: where the site serves the phonemizer for the ONNX voice; `es`: which engine speaks Spanish (`device`: the phone's Mexican voice, decision D7). |
| `asr` | speech-to-text models per language; `hintBudget`: Whisper prompt tokens for names (0: no names; at most 220 of Whisper's 223). |
| `limits` | `recMaxMs`, `endSilenceMs`, `minSpeechMs`, `leadMs`, `tailMs` (defaults in `browser/listen.js`). |
| `packs`, `city`, `domains`, `langs` | which city packs and domains the page answers from. |

`index.json` lists the apps and their hosts, so the check page (`browser/check.html`) picks a site's config by host, as a
site's page does by loading its own.
