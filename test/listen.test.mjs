// listen.js: when a spoken question has ended, and which part of the recording is speech.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CORE, REC_MAX_MS, END_SILENCE_MS, MIN_SPEECH_MS, LEAD_MS, TAIL_MS, detector, joinPcm, speechAt16k, to16k } from "../browser/listen.js";

const RATE = 48000, BLOCK = 2048;

// Blocks of sound: [seconds, amplitude] pieces, a 200 Hz tone (amplitude 0 = a quiet room with a little hiss).
function blocks(pieces, rate = RATE) {
  const total = Math.round(pieces.reduce((s, [sec]) => s + sec, 0) * rate);
  const pcm = new Float32Array(total);
  let at = 0, seed = 1;
  for (const [sec, amp] of pieces) {
    const n = Math.round(sec * rate);
    for (let i = 0; i < n; i++, at++) {
      seed = (seed * 16807) % 2147483647;
      pcm[at] = amp * Math.sin((2 * Math.PI * 200 * at) / rate) + 0.001 * (seed / 2147483647 - 0.5);
    }
  }
  const out = [];
  for (let i = 0; i + BLOCK <= pcm.length; i += BLOCK) out.push(pcm.slice(i, i + BLOCK));
  return out;
}

const feedAll = (d, list) => list.map((b) => d.feed(b));

test("the settings are the ones both sites used", () => {
  assert.equal(CORE, "tiny-speech 0.3.0");
  assert.deepEqual([REC_MAX_MS, END_SILENCE_MS, MIN_SPEECH_MS, LEAD_MS, TAIL_MS], [5000, 700, 250, 250, 300]);
});

test("a site's own limits (its config) change when a question ends and how much is kept", () => {
  const list = blocks([[0.5, 0], [1.0, 0.2], [1.5, 0]]);
  const ends = (limits) => feedAll(detector(RATE, limits), list).indexOf("end");
  assert.ok(ends({ END_SILENCE_MS: 1200 }) > ends({}), "a longer pause before the end");
  const d = detector(RATE, { LEAD_MS: 0, TAIL_MS: 0 });
  feedAll(d, list);
  assert.ok(speechAt16k(d).length < speechAt16k(d, {}).length, "no lead or tail");
});

test("speech starts on the second loud block and ends after 0.7 s of quiet", () => {
  const d = detector(RATE);
  const events = feedAll(d, blocks([[0.5, 0], [1.0, 0.2], [1.0, 0]]));
  const speech = events.indexOf("speech"), end = events.indexOf("end");
  assert.ok(speech > 0 && end > speech, `events: speech at ${speech}, end at ${end}`);
  const quietAfter = ((end + 1) * BLOCK - d.lastVoice) / RATE;
  assert.ok(quietAfter >= 0.7 && quietAfter < 0.7 + BLOCK / RATE, `ended ${quietAfter.toFixed(3)} s after the last loud block`);
});

test("a click shorter than MIN_SPEECH_MS does not end a question", () => {
  const d = detector(RATE);
  const events = feedAll(d, blocks([[0.3, 0], [0.1, 0.3], [1.5, 0]]));
  assert.ok(events.includes("speech"));
  assert.ok(!events.includes("end"), "0.1 s of sound is not a question");
});

test("silence alone is never speech", () => {
  const d = detector(RATE);
  assert.deepEqual(feedAll(d, blocks([[2, 0]])).filter(Boolean), []);
});

test("the speech is cut out with 0.25 s before and 0.3 s after, at 16 kHz", () => {
  const d = detector(RATE);
  feedAll(d, blocks([[1.0, 0], [1.0, 0.2], [1.0, 0]]));
  const pcm = speechAt16k(d);
  const seconds = pcm.length / 16000;
  assert.ok(seconds > 1.0 + 0.25 && seconds < 1.0 + 0.25 + 0.3 + 0.1, `${seconds.toFixed(3)} s`);
});

test("with no speech found, the whole recording is kept", () => {
  const d = detector(RATE);
  const list = blocks([[0.5, 0]]);
  feedAll(d, list);
  assert.equal(speechAt16k(d).length, Math.floor((list.length * BLOCK) / 3));
});

test("to16k averages and keeps 16 kHz input as it is", () => {
  assert.deepEqual([...to16k(Float32Array.from([1, 2, 3, 4, 5, 6]), 48000)], [2, 5]);
  const same = Float32Array.from([0.5, -0.5]);
  const out = to16k(same, 16000);
  assert.deepEqual([...out], [0.5, -0.5]);
  assert.notEqual(out, same, "a copy, not the same array");
  assert.deepEqual([...joinPcm([Float32Array.from([1]), Float32Array.from([2, 3])], 3)], [1, 2, 3]);
});
