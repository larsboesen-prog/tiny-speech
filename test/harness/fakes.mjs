// Stand-ins for the libraries and model files the voice workers load from the network (transformers.js, Pyodide,
// onnxruntime-web, Hugging Face). They are small and deterministic, and they report every call back through the worker's own
// postMessage as {type: "__fake", entry}, so an original worker and the shared one can be compared call for call.
// Nothing here is a model: no speech is recognised or made.

const LOG = `var __fakeLog = (...entry) => self.postMessage({ type: "__fake", entry: JSON.parse(JSON.stringify(entry)) });`;

// transformers.js 3.8.1 (an ES module): pipeline() and a Whisper-like tokenizer with the special tokens the ASR worker looks up.
export const TRANSFORMERS = `${LOG}
export const env = { backends: { onnx: { wasm: {} } } };
const SPECIAL = new Map([["<|startofprev|>", 1], ["<|startoftranscript|>", 2], ["<|notimestamps|>", 3], ["<|es|>", 4], ["<|en|>", 5], ["<|transcribe|>", 6]]);
export async function pipeline(task, id, options) {
  __fakeLog("pipeline", task, id, { device: options.device, dtype: options.dtype, numThreads: env.backends.onnx.wasm.numThreads });
  if (id.startsWith("fail/")) throw new Error("no such model: " + id);
  // As onnxruntime does: its engine (.wasm) is fetched through the worker's fetch, which keeps it in Cache Storage.
  const engine = await fetch("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0-dev/dist/ort-wasm-simd-threaded.jsep.wasm");
  __fakeLog("engine", engine.status, (await engine.arrayBuffer()).byteLength);
  options.progress_callback({ status: "progress", file: "onnx/encoder_model_q8.onnx", loaded: 30, total: 60 });
  options.progress_callback({ status: "progress", file: "onnx/decoder_model_q8.onnx", loaded: 40, total: 40 });
  options.progress_callback({ status: "done", file: "onnx/decoder_model_q8.onnx" });
  const model = async (audio, opts) => {
    __fakeLog("run", id, audio.length, opts);
    // Whisper writes a prompt's words back before the transcript; the worker cuts them off.
    const ids = opts.decoder_input_ids || [];
    const said = ids.includes(1) ? model.tokenizer.decode(ids.slice(ids.indexOf(1) + 1, ids.indexOf(2))) : "";
    return { text: said + " what is open tonight " + audio.length };
  };
  model.tokenizer = {
    model: { tokens_to_ids: SPECIAL },
    encode: (text) => [...text].map((c) => 1000 + c.codePointAt(0)),
    decode: (ids) => ids.filter((i) => i >= 1000).map((i) => String.fromCodePoint(i - 1000)).join(""),
  };
  model.dispose = async () => __fakeLog("dispose", id);
  return model;
}
`;

// Pyodide 0.26.4's pyodide.js (a classic script): loadPyodide() with the parts the voice worker uses, and dizione's two functions.
// runPython is logged by a hash of its code, without MapSMA's teach_json definition: defining a function the page never calls
// (CredBrief never sends "teach") is the one expected difference between /page40's worker and the shared one.
export const PYODIDE = `${LOG}
self.loadPyodide = async ({ indexURL }) => {
  __fakeLog("loadPyodide", indexURL);
  const runtime = await fetch(indexURL + "pyodide.asm.wasm");
  __fakeLog("runtime", runtime.status, (await runtime.arrayBuffer()).byteLength);
  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0; return h; };
  const functions = {
    phonemize_json: (text) => {
      __fakeLog("phonemize", text);
      const ids = [...text].filter((c) => /[A-Za-z0-9]/.test(c)).map((c) => 20 + (c.charCodeAt(0) % 50));
      if (!ids.length) return "null";
      return JSON.stringify({ ids: [1, ...ids, 2], stress: [0, ...ids.map((x) => x % 3), 0], text: "ph(" + text + ")" });
    },
    teach_json: (words) => { __fakeLog("teach_json", words); return Object.keys(JSON.parse(words)).length; },
  };
  return {
    loadPackage: async (name) => __fakeLog("loadPackage", name),
    FS: { mkdirTree: (dir) => __fakeLog("mkdirTree", dir), writeFile: (path, bytes) => __fakeLog("writeFile", path, bytes.length) },
    unpackArchive: (buffer, format, options) => __fakeLog("unpackArchive", buffer.byteLength, format, options),
    runPython: (code) => __fakeLog("runPython", hash(code.replace(/# MapSMA \\/page5 \\(17 Nov 2026\\): Spanish names[\\s\\S]*?return taught\\n\\n/, ""))),
    globals: { get: (name) => functions[name] },
  };
};
`;

// onnxruntime-web 1.18.0's ort.wasm.min.js (a classic script): Tensor and InferenceSession; the "voice" is a fixed waveform whose
// length follows the number of tokens, so sentence audio can be compared across workers.
export const ORT = `${LOG}
self.ort = {
  env: { wasm: {} },
  Tensor: class { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } },
  InferenceSession: {
    create: async (bytes, options) => {
      __fakeLog("ort.create", bytes.length, options, { numThreads: self.ort.env.wasm.numThreads, wasmPaths: self.ort.env.wasm.wasmPaths });
      const engine = await fetch(self.ort.env.wasm.wasmPaths + "ort-wasm-simd.wasm");
      __fakeLog("ort.engine", engine.status, (await engine.arrayBuffer()).byteLength);
      return {
        run: async (feeds) => {
          const seen = {};
          for (const [name, t] of Object.entries(feeds)) seen[name] = { type: t.type, dims: t.dims, data: Array.from(t.data, (x) => typeof x === "bigint" ? Number(x) : Math.round(x * 1000) / 1000) };
          __fakeLog("ort.run", seen);
          const n = feeds.tokens.dims[1] * 120;
          const audio = new Float32Array(n);
          for (let i = 0; i < n; i++) audio[i] = 0.05 + 1.3 * Math.sin(i / 7) * Math.sin(i / 300);
          return { audio: { data: audio } };
        },
      };
    },
  },
};
`;

export const TINY_VOCA_REV = "d94d2a0338fd1e0eab7dd896ec0ad23d8cdf7c14";
const CONFIG = JSON.stringify({ voices: ["F2", "M2"], sample_rate: 24000, model: { max_tokens: 40 } });

/** Route every network library and model file of the workers to the stand-ins; count each request in `hits`. */
export async function installFakes(context, hits) {
  const count = (url) => { hits[url] = (hits[url] || 0) + 1; };
  await context.route("https://cdn.jsdelivr.net/**", (route) => {
    const url = route.request().url();
    count(url);
    if (url === "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1") return route.fulfill({ contentType: "text/javascript", body: TRANSFORMERS });
    if (url.endsWith("/pyodide/v0.26.4/full/pyodide.js")) return route.fulfill({ contentType: "text/javascript", body: PYODIDE });
    if (url.endsWith("/onnxruntime-web@1.18.0/dist/ort.wasm.min.js")) return route.fulfill({ contentType: "text/javascript", body: ORT });
    if (url.endsWith(".wasm")) return route.fulfill({ contentType: "application/wasm", body: Buffer.alloc(1500, 7) });
    return route.fulfill({ status: 404, body: "not faked: " + url });
  });
  await context.route("https://huggingface.co/**", (route) => {
    const url = route.request().url();
    count(url);
    const base = `https://huggingface.co/n4ze3m/tiny-voca/resolve/${TINY_VOCA_REV}/`;
    if (url === base + "config.json") return route.fulfill({ contentType: "application/json", body: CONFIG });
    if (url === base + "onnx/model.onnx") return route.fulfill({ contentType: "application/octet-stream", body: Buffer.alloc(4000, 3) });
    if (url.startsWith(base + "phonemizer/")) return route.fulfill({ contentType: "application/octet-stream", body: Buffer.alloc(700, 5) });
    return route.fulfill({ status: 404, body: "not faked: " + url });
  });
}
