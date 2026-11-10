// Owns the AudioContext and the worklet node. Everything else talks to the
// DSP through this class; it is safe to call setters before start().

import { KASTLE_SAMPLES, KASTLE_WAVES } from './dsp/kastle-samples.js';
import { KITS } from './kits.js';
import { SCALES, ALT_TUNINGS } from './music.js';
import { encodeWav } from './wav.js';

export class Engine {
  constructor({ onMeter, onError } = {}) {
    this.ctx = null;
    this.node = null;
    this.analyser = null;
    this.onMeter = onMeter || (() => {});
    this.onError = onError || ((e) => console.error(e));
    this.rec = null;
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
    else if (msg.type === 'rec' || msg.type === 'recDone') this.onRecMessage(msg);
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

  // ---- recording -----------------------------------------------------------
  // The worklet streams the exact output samples in numbered chunks. Stopping
  // waits for its 'recDone' handshake (sent after the final chunk), so the end
  // of a take is never cut off, then checks the frame count before encoding.

  get recording() { return !!this.rec; }

  startRecording() {
    if (!this.node) return false;
    const id = ((this.rec && this.rec.id) || 0) + 1;
    this.rec = { id, chunks: [], samples: 0, nextSeq: 0, gaps: 0, startedAt: performance.now(), done: null };
    this.post({ type: 'rec', on: true, id });
    return true;
  }

  // Seconds captured so far (counted from the chunks that have arrived).
  recordedSeconds() {
    if (!this.rec || !this.ctx) return 0;
    return this.rec.samples / 2 / this.ctx.sampleRate;
  }

  // Resolves with { blob, frames, seconds, peak, clipped, complete, bits }.
  stopRecording({ bits = 24 } = {}) {
    const rec = this.rec;
    if (!rec) return Promise.resolve(null);
    return new Promise((resolve) => {
      const finish = (done) => {
        clearTimeout(timer);
        this.rec = null;
        const sr = this.ctx.sampleRate;
        const out = encodeWav(rec.chunks, sr, { bits });
        const complete = !!done && rec.gaps === 0 && out.frames === done.frames;
        resolve({
          blob: new Blob([out.buffer], { type: 'audio/wav' }),
          frames: out.frames, seconds: out.seconds, peak: out.peak, clipped: out.clipped,
          complete, expectedFrames: done ? done.frames : null, bits,
        });
      };
      rec.done = finish;
      // Safety net only: if the audio thread has stopped (tab closed, context
      // suspended mid-take) we still deliver what arrived, flagged incomplete.
      const timer = setTimeout(() => finish(null), 5000);
      this.post({ type: 'rec', on: false });
    });
  }

  onRecMessage(msg) {
    const rec = this.rec;
    if (!rec || msg.id !== rec.id) return;
    if (msg.type === 'rec') {
      if (msg.seq !== rec.nextSeq) rec.gaps++;
      rec.nextSeq = msg.seq + 1;
      rec.chunks.push(msg.data);
      rec.samples += msg.data.length;
    } else if (msg.type === 'recDone' && rec.done) {
      if (msg.chunks !== rec.nextSeq) rec.gaps++;
      rec.done(msg);
    }
  }
}
