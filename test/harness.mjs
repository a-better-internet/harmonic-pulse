// Minimal AudioWorkletGlobalScope mock so the processor can run in Node.
import { KASTLE_TABLES } from '../src/dsp/kastle-samples.js';
import { SCALES, ALT_TUNINGS } from '../src/music.js';

export async function loadProcessor(sr = 48000) {
  globalThis.sampleRate = sr;
  let Proc = null;
  globalThis.AudioWorkletProcessor = class {
    constructor() {
      this.port = { onmessage: null, posted: [], postMessage(m) { this.posted.push(m); } };
    }
  };
  globalThis.registerProcessor = (name, cls) => { Proc = cls; };
  await import('../src/dsp/harmonic-pulse-processor.js?' + Math.random());
  return (extra = {}) => {
    const p = new Proc({
      processorOptions: {
        tables: KASTLE_TABLES,
        scales: SCALES.map((s) => s.steps),
        tunings: ALT_TUNINGS.map((t) => t.ratios),
        ...extra,
      },
    });
    p.send = (msg) => p.port.onmessage({ data: msg });
    p.renderSeconds = (sec) => {
      const n = Math.ceil((sec * sr) / 128);
      const L = new Float32Array(n * 128), R = new Float32Array(n * 128);
      for (let b = 0; b < n; b++) {
        const oL = new Float32Array(128), oR = new Float32Array(128);
        p.process([], [[oL, oR]]);
        L.set(oL, b * 128); R.set(oR, b * 128);
      }
      return { L, R };
    };
    return p;
  };
}

export function stats(buf) {
  let peak = 0, sum = 0, nan = 0;
  for (const v of buf) { if (!Number.isFinite(v)) nan++; else { peak = Math.max(peak, Math.abs(v)); sum += v * v; } }
  return { peak, rms: Math.sqrt(sum / buf.length), nan };
}

export function writeWav(path, L, R, sr, fs) {
  const n = L.length, data = Buffer.alloc(44 + n * 4);
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * 4, 4); data.write('WAVE', 8);
  data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22);
  data.writeUInt32LE(sr, 24); data.writeUInt32LE(sr * 4, 28); data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4);
    data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(R[i] * 32767))), 46 + i * 4);
  }
  fs.writeFileSync(path, data);
}

// Dominant frequency via autocorrelation-free DFT scan of a window (coarse).
export function dominantHz(buf, sr, from, len, fmin = 40, fmax = 2000) {
  let best = 0, bestP = 0;
  for (let f = fmin; f <= fmax; f *= 1.003) {
    let re = 0, im = 0;
    const w = (TAU_) => 0;
    for (let i = 0; i < len; i++) {
      const ph = (2 * Math.PI * f * i) / sr;
      const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / len);
      re += buf[from + i] * Math.cos(ph) * win; im += buf[from + i] * Math.sin(ph) * win;
    }
    const pw = re * re + im * im;
    if (pw > bestP) { bestP = pw; best = f; }
  }
  return best;
}
