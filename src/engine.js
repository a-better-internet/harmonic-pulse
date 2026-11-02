// Owns the AudioContext and the worklet node. Everything else talks to the
// DSP through this class; it is safe to call setters before start().

import { KASTLE_SAMPLES, KASTLE_WAVES } from './dsp/kastle-samples.js';
import { KITS } from './kits.js';
import { SCALES, ALT_TUNINGS } from './music.js';

export class Engine {
  constructor({ onMeter, onError } = {}) {
    this.ctx = null;
    this.node = null;
    this.analyser = null;
    this.onMeter = onMeter || (() => {});
    this.onError = onError || ((e) => console.error(e));
    this.recChunks = null;
    this.state = { params: {}, cables: [], wingie: null };
  }

  get running() { return !!this.ctx && this.ctx.state === 'running'; }

  async start() {
    if (this.ctx) { await this.ctx.resume(); return; }
    if (!window.AudioContext || !window.AudioWorkletNode) {
      throw new Error('This browser does not support AudioWorklet. Try a current Chrome, Edge, Firefox or Safari.');
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    await ctx.audioWorklet.addModule(new URL('./dsp/harmonic-pulse-processor.js', import.meta.url));
    const node = new AudioWorkletNode(ctx, 'harmonic-pulse', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: {
        samples: KASTLE_SAMPLES,
        kits: KITS.map((k) => k.slots),
        waves: Object.values(KASTLE_WAVES),
        scales: SCALES.map((s) => s.steps),
        tunings: ALT_TUNINGS.map((t) => t.ratios),
      },
    });
    node.port.onmessage = (e) => this.onMessage(e.data);
    node.onprocessorerror = () => this.onError(new Error('The audio processor stopped.'));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.6;
    node.connect(analyser);
    analyser.connect(ctx.destination);
    this.node = node;
    this.analyser = analyser;
    // replay everything set before the context existed
    this.post({ type: 'params', values: this.state.params });
    this.post({ type: 'cables', cables: this.state.cables });
    if (this.state.wingie) this.post({ type: 'wingie', state: this.state.wingie, resetSeq: [true, true] });
    await ctx.resume();
  }

  async suspend() { if (this.ctx) await this.ctx.suspend(); }

  post(msg, transfer) { if (this.node) this.node.port.postMessage(msg, transfer || []); }

  onMessage(msg) {
    if (!msg) return;
    if (msg.type === 'meter') this.onMeter(msg);
    else if (msg.type === 'rec' && this.recChunks) this.recChunks.push(msg.data);
    else if (msg.type === 'error') this.onError(new Error(msg.message));
  }

  setParams(values) {
    Object.assign(this.state.params, values);
    this.post({ type: 'params', values });
  }

  setCables(cables) {
    this.state.cables = cables.map((c) => [c[0], c[1]]);
    this.post({ type: 'cables', cables: this.state.cables });
  }

  setWingie(state, resetSeq) {
    this.state.wingie = state;
    this.post({ type: 'wingie', state, resetSeq });
  }

  hit(strong = true) { this.post({ type: 'hit', strong }); }
  advance() { this.post({ type: 'advance' }); }
  regenerate() { this.post({ type: 'regen' }); }
  panic() { this.post({ type: 'panic' }); }

  startRecording() {
    if (!this.node) return false;
    this.recChunks = [];
    this.post({ type: 'rec', on: true });
    return true;
  }

  // Resolves with a 16-bit stereo WAV blob.
  stopRecording() {
    return new Promise((resolve) => {
      if (!this.recChunks) { resolve(null); return; }
      this.post({ type: 'rec', on: false });
      setTimeout(() => {
        const chunks = this.recChunks || [];
        this.recChunks = null;
        resolve(encodeWav(chunks, this.ctx.sampleRate));
      }, 150);
    });
  }
}

function encodeWav(chunks, sr) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const frames = total >> 1;
  const buf = new ArrayBuffer(44 + frames * 4);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + frames * 4, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, frames * 4, true);
  let o = 44;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++) {
      const s = Math.max(-1, Math.min(1, c[i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}
