// MapSMA /page5 (Ask by voice, 17 Nov 2026): copied from CredBrief's /page40, where it was built and tested; keep the two in step.
// page40 (Ask CredBrief): the microphone's raw sound, in blocks of 2048 samples, for the page (17 Nov 2026). Recording raw sound
// replaces MediaRecorder: no compressing and decompressing (an iPad failed to decode its own recording), and the page can hear when
// the reader stops talking and send the question by itself.
class PcmTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(2048);
    this.n = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf, [this.buf.buffer]);
          this.buf = new Float32Array(2048);
          this.n = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("pcm-tap", PcmTap);
