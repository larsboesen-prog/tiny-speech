// page40 (Ask CredBrief): when a spoken question has ended, and which part of the recording is speech (17 Nov 2026; Lars: "allowing
// questions to last five seconds max with a timer so it's auto sent without waiting for a long pause or send").
//
// Every block of sound (2048 samples, about 0.04 s) is measured. Speech has started when two blocks in a row are louder than three times
// the quietest block so far (never below 0.006 or above 0.03 RMS, so a silent room and a noisy one both work). After at least
// MIN_SPEECH_MS of speech, END_SILENCE_MS of quiet ends the question; the page also ends it at REC_MAX_MS. Only the speech, with
// LEAD_MS before and TAIL_MS after, is turned into text: no silence to read.

export const REC_MAX_MS = 5000;
export const END_SILENCE_MS = 700;
export const MIN_SPEECH_MS = 250;
export const LEAD_MS = 250;
export const TAIL_MS = 300;

export function detector(rate) {
  const d = { rate, chunks: [], n: 0, loud: 0, runStart: -1, speechAt: -1, lastVoice: -1, voicedMs: 0, noise: Infinity };
  // One block in; "end" once the question is over, "speech" on the block where speech starts, else null.
  d.feed = (buf) => {
    d.chunks.push(buf);
    const at = d.n;
    d.n += buf.length;
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    d.rms = rms;  // the last block's loudness: the page's level meter
    d.noise = Math.min(d.noise, rms);
    let event = null;
    if (rms > Math.min(0.03, Math.max(0.006, 3 * d.noise))) {
      if (d.loud === 0) d.runStart = at;
      d.loud += 1;
      if (d.loud >= 2 && d.speechAt < 0) { d.speechAt = d.runStart; event = "speech"; }
      if (d.speechAt >= 0) { d.lastVoice = d.n; d.voicedMs += (1000 * buf.length) / rate; }
    } else d.loud = 0;
    if (d.speechAt >= 0 && d.voicedMs >= MIN_SPEECH_MS && ((d.n - d.lastVoice) * 1000) / rate >= END_SILENCE_MS) return "end";
    return event;
  };
  return d;
}

export function joinPcm(chunks, n) {
  const out = new Float32Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// The speech of a recording at 16 kHz, the rate the speech models read: all of it when no speech was found (the model decides then).
export function speechAt16k(d) {
  let pcm = joinPcm(d.chunks, d.n);
  if (d.speechAt >= 0) pcm = pcm.subarray(Math.max(0, d.speechAt - Math.round((d.rate * LEAD_MS) / 1000)), Math.min(d.n, d.lastVoice + Math.round((d.rate * TAIL_MS) / 1000)));
  return to16k(pcm, d.rate);
}

export function to16k(x, rate) {  // averaged down: each output sample is the mean of the input samples it covers
  if (Math.round(rate) === 16000) return x.slice();
  const ratio = rate / 16000, n = Math.floor(x.length / ratio), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio), b = Math.max(a + 1, Math.min(x.length, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = a; j < b; j++) sum += x[j];
    out[i] = sum / (b - a);
  }
  return out;
}
