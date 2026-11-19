# Sizes, measured

Made by `tools/sizes.mjs` from the files themselves: the core's in this repository, the engine files listed in `browser/engines.json`
(recorded 2026-11-19 from the real libraries, each with its SHA-256).
Brotli at quality 11, or 9 for files over 1 MB. What crosses the network depends on the server: jsDelivr compresses its files,
Hugging Face sends model files as they are; once stored on the phone, nothing is downloaded again.

| Part | Files | Raw | gzip | brotli |
|---|---|---|---|---|
| Ears: transformers.js + its onnxruntime (both languages) | 3 | 22.5 MB | 5.3 MB | 3.7 MB |
| Ears, English: Whisper tiny.en, 8-bit | 7 | 43.5 MB | 24.8 MB | 24.0 MB |
| Ears, Spanish: Whisper tiny (multilingual), 8-bit | 7 | 43.6 MB | 27.3 MB | 26.7 MB |
| Voice today: tiny-voca ONNX + onnxruntime 1.18 + Pyodide (dizione) | 15 | 63.2 MB | 33.2 MB | 29.6 MB |
| Voice, plain JS: tiny-voca GGUF | 1 | 8.0 MB | 7.5 MB | 7.5 MB |
| Core code: browser/, core/, lang/, domains/, engines/ (JavaScript) | 27 | 282.0 KB | 105.0 KB | 91.9 KB |
| tiny-voca's plain-JS runtime (vendor/tiny-voca/js) | 14 | 174.6 KB | 54.1 KB | 47.5 KB |
| Site configs and data the core reads (apps/, lang/*.json) | 5 | 10.5 KB | 4.4 KB | 3.7 KB |
| City pack mx-sma (100 places) | 3 | 74.8 KB | 18.6 KB | 15.7 KB |
| City pack xx-test (14 places) | 3 | 7.9 KB | 2.5 KB | 2.2 KB |

| A page's first visit | Raw | brotli |
|---|---|---|
| MapSMA English today (ears + ONNX voice + core + pack) | 129.7 MB | 57.5 MB |
| MapSMA English, plain-JS voice | 74.6 MB | 35.4 MB |
| … and Spanish questions (second Whisper) | 118.2 MB | 62.1 MB |
| CredBrief (ears English + ONNX voice + core) | 129.6 MB | 57.4 MB |

## Every file

| File | Raw | gzip | brotli |
|---|---|---|---|
| cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/index.js | 888173 | 222400 | 182225 |
| cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/ort-wasm-simd-threaded.jsep.mjs | 44484 | 15390 | 13540 |
| cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/ort-wasm-simd-threaded.jsep.wasm | 21596019 | 5046898 | 3504369 |
| huggingface.co/onnx-community/whisper-tiny.en/resolve/main/config.json | 2197 | 838 | 680 |
| huggingface.co/onnx-community/whisper-tiny.en/resolve/main/generation_config.json | 1646 | 563 | 442 |
| huggingface.co/onnx-community/whisper-tiny.en/resolve/main/onnx/decoder_model_merged_quantized.onnx | 30718858 | 17774501 | 17653446 |
| huggingface.co/onnx-community/whisper-tiny.en/resolve/main/onnx/encoder_model_quantized.onnx | 10124993 | 6444567 | 5850501 |
| huggingface.co/onnx-community/whisper-tiny.en/resolve/main/preprocessor_config.json | 339 | 215 | 182 |
| huggingface.co/onnx-community/whisper-tiny.en/resolve/main/tokenizer_config.json | 282662 | 9542 | 4900 |
| huggingface.co/onnx-community/whisper-tiny.en/resolve/main/tokenizer.json | 2405679 | 594204 | 531912 |
| huggingface.co/onnx-community/whisper-tiny/resolve/main/config.json | 2243 | 845 | 683 |
| huggingface.co/onnx-community/whisper-tiny/resolve/main/generation_config.json | 3772 | 1099 | 801 |
| huggingface.co/onnx-community/whisper-tiny/resolve/main/onnx/decoder_model_merged_quantized.onnx | 30719241 | 20331566 | 20294659 |
| huggingface.co/onnx-community/whisper-tiny/resolve/main/onnx/encoder_model_quantized.onnx | 10124990 | 6374156 | 5815947 |
| huggingface.co/onnx-community/whisper-tiny/resolve/main/preprocessor_config.json | 339 | 215 | 182 |
| huggingface.co/onnx-community/whisper-tiny/resolve/main/tokenizer_config.json | 282683 | 9549 | 4873 |
| huggingface.co/onnx-community/whisper-tiny/resolve/main/tokenizer.json | 2480466 | 629867 | 558778 |
| cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort-wasm-simd.wasm | 10595041 | 2816839 | 2059200 |
| cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort.wasm.min.js | 142930 | 47308 | 30986 |
| cdn.jsdelivr.net/pyodide/v0.26.4/full/numpy-1.26.4-cp312-cp312-pyodide_2024_0_wasm32.whl | 11959269 | 2856952 | 2152143 |
| cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide-lock.json | 106335 | 22341 | 18922 |
| cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.asm.js | 1229099 | 232248 | 214363 |
| cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.asm.wasm | 10088051 | 3220575 | 2611075 |
| cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js | 14761 | 5896 | 5331 |
| cdn.jsdelivr.net/pyodide/v0.26.4/full/python_stdlib.zip | 2341872 | 2304466 | 2296272 |
| huggingface.co/n4ze3m/tiny-voca/resolve/d94d2a0338fd1e0eab7dd896ec0ad23d8cdf7c14/config.json | 2129 | 972 | 796 |
| huggingface.co/n4ze3m/tiny-voca/resolve/d94d2a0338fd1e0eab7dd896ec0ad23d8cdf7c14/onnx/model.onnx | 21386372 | 19107346 | 17679739 |
| huggingface.co/n4ze3m/tiny-voca/resolve/d94d2a0338fd1e0eab7dd896ec0ad23d8cdf7c14/phonemizer/align.json | 29729 | 10363 | 8783 |
| huggingface.co/n4ze3m/tiny-voca/resolve/d94d2a0338fd1e0eab7dd896ec0ad23d8cdf7c14/phonemizer/g2p.json | 834 | 373 | 292 |
| huggingface.co/n4ze3m/tiny-voca/resolve/d94d2a0338fd1e0eab7dd896ec0ad23d8cdf7c14/phonemizer/g2p.npz | 1840104 | 1702961 | 1700149 |
| huggingface.co/n4ze3m/tiny-voca/resolve/d94d2a0338fd1e0eab7dd896ec0ad23d8cdf7c14/phonemizer/homographs.json | 51956 | 10313 | 8790 |
| huggingface.co/n4ze3m/tiny-voca/resolve/d94d2a0338fd1e0eab7dd896ec0ad23d8cdf7c14/phonemizer/lexicon.tsv | 3454357 | 855696 | 811935 |
| huggingface.co/n4ze3m/tiny-voca/resolve/1e73262226dbf4ef02e9df277e81aaa1db5ce16c/gguf/tiny-voca-js.gguf | 7988384 | 7525155 | 7503887 |
| browser/asr-worker.js | 12224 | 5028 | 4379 |
| browser/check.js | 20202 | 7273 | 6378 |
| browser/listen.js | 3738 | 1681 | 1457 |
| browser/pcm-worklet.js | 1046 | 572 | 463 |
| browser/tinyvoca-js-worker.js | 6950 | 2837 | 2429 |
| browser/tinyvoca-worker.js | 16887 | 6701 | 5843 |
| core/config.js | 4189 | 1851 | 1623 |
| core/lang-decide.js | 3959 | 1734 | 1482 |
| core/lid/text-lid.js | 4553 | 2220 | 1917 |
| core/pack/assemble.js | 1102 | 575 | 473 |
| core/pack/hint.js | 3241 | 1588 | 1367 |
| core/pack/loader.js | 7978 | 2814 | 2472 |
| core/pack/schema.js | 12752 | 4817 | 4186 |
| core/text/normalize.js | 5322 | 2100 | 1830 |
| core/text/sound.js | 1946 | 987 | 877 |
| domains/music/index.js | 12455 | 4767 | 4255 |
| domains/news/feed.js | 2235 | 1105 | 953 |
| domains/news/index.js | 7654 | 3245 | 2867 |
| domains/places/ask.js | 64453 | 19184 | 16995 |
| domains/places/read.js | 48456 | 16960 | 14768 |
| lang/en/index.js | 4265 | 1829 | 1656 |
| lang/es/index.js | 5121 | 2190 | 1973 |
| lang/es/ipa.js | 6253 | 2570 | 2281 |
| lang/es/sounds.js | 12242 | 4700 | 4136 |
| engines/asr-whisper.js | 3797 | 1617 | 1396 |
| engines/tinyvoca-js.js | 6264 | 2751 | 2390 |
| engines/whisper-tokens.js | 2728 | 1255 | 1093 |
| vendor/tiny-voca/js/dizione/align.js | 1534 | 669 | 610 |
| vendor/tiny-voca/js/dizione/convert.js | 13802 | 4084 | 3616 |
| vendor/tiny-voca/js/dizione/engine.js | 10484 | 3076 | 2741 |
| vendor/tiny-voca/js/dizione/g2p.js | 4710 | 1524 | 1378 |
| vendor/tiny-voca/js/dizione/homographs.js | 8089 | 3104 | 2655 |
| vendor/tiny-voca/js/dizione/lexicon.js | 1887 | 873 | 760 |
| vendor/tiny-voca/js/dizione/morphology.js | 8040 | 2462 | 2210 |
| vendor/tiny-voca/js/dizione/normalize.js | 65520 | 19518 | 16832 |
| vendor/tiny-voca/js/dizione/pyre.js | 27867 | 8001 | 7113 |
| vendor/tiny-voca/js/dizione/sentence.js | 3462 | 1154 | 1018 |
| vendor/tiny-voca/js/dizione/symbols.js | 2060 | 892 | 770 |
| vendor/tiny-voca/js/dizione/tables.js | 3188 | 1078 | 917 |
| vendor/tiny-voca/js/text.js | 2654 | 1194 | 1053 |
| vendor/tiny-voca/js/tiny-voca.js | 21254 | 6503 | 5839 |
| browser/check.html | 7006 | 2546 | 2068 |
| lang/es/mx.json | 2095 | 1034 | 911 |
| apps/credbrief.json | 503 | 290 | 249 |
| apps/index.json | 286 | 178 | 152 |
| apps/mapsma.json | 630 | 345 | 291 |
| packs/dist/mx-sma/2026-11-19.c6dbb0/manifest.json | 2684 | 1144 | 990 |
| packs/dist/mx-sma/2026-11-19.c6dbb0/base.json | 59627 | 15694 | 13433 |
| packs/dist/mx-sma/live.a6f7f223.json | 12499 | 1730 | 1281 |
| packs/dist/xx-test/2026-11-19.9677eb/manifest.json | 2131 | 892 | 786 |
| packs/dist/xx-test/2026-11-19.9677eb/base.json | 3798 | 1276 | 1121 |
| packs/dist/xx-test/live.bf54b7bb.json | 2008 | 372 | 287 |
