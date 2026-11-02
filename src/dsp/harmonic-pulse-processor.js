/*
 * Harmonic Pulse — AudioWorklet processor.
 *
 * Signal flow (all inside one worklet so every patch cable is sample-accurate):
 *
 *   CLOCK chip (square / triangle / stepped voltage) ─┐
 *   UTILITY (clock dividers, drift LFO) ──────────────┤  patch bay (cables)
 *                                                     ▼
 *   KASTLE DRUM VCO chip ─► PRE-SHAPER ─► WINGIE resonator ─► HP ─► LP ─► COLOR ─► TAPE ECHO ─► REVERB ─► MASTER
 *
 * The Kastle Drum VCO is a port of kastleDrum.ino (Bastl Instruments, CC BY-SA):
 * the timer ISR, main loop and ADC round-robin run at the ATtiny85's own rates
 * with its 8/16-bit integer arithmetic, then get resampled to the audio rate.
 *
 * The Wingie resonator is a port of Wingie2.dsp and firmware (Meng Qi, Dave Seidel; GPL-3.0 repo):
 * nine "controlled modal rotation" resonators per side with block-rate
 * coefficients and the anti-feedback energy guard, plus the firmware's
 * Poly / String / Bar / Cave / Ratio frequency layouts and threshold sequencer.
 */

const TAU = Math.PI * 2;
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

// ---------------------------------------------------------------------------
// Patch bay layout. Keep in sync with src/patch-def.js.
// ---------------------------------------------------------------------------
const SOURCES = [
  'k.out', 'k.noise', 'k.env',
  'c.clk', 'c.tri', 'c.step',
  'u.div2', 'u.div3', 'u.div4', 'u.div8', 'u.drift',
  'w.trigL', 'w.trigR', 'w.env',
];
const DESTS = [
  'k.trig', 'k.drum', 'k.pitch', 'k.decay',
  'c.rate', 'c.stepclk',
  'w.noteL', 'w.noteR', 'w.adv', 'w.decay',
  's.fold', 'f.lp', 'f.hp',
];
const AMT_KEYS = DESTS.map((d) => 'amt.' + d);
const SRC = Object.fromEntries(SOURCES.map((n, i) => [n, i]));
const DST = Object.fromEntries(DESTS.map((n, i) => [n, i]));

// ---------------------------------------------------------------------------
// Kastle Drum VCO chip (ATtiny85 @ 8 MHz)
// ---------------------------------------------------------------------------
// Timer1: 64 MHz PLL in low-speed mode (32 MHz) / 8, CTC at 256 counts.
const KASTLE_ISR_HZ = 32000000 / 8 / 256; // 15625 Hz
// ADC: 8 MHz / 128 prescaler, 13 ADC clocks per conversion.
const KASTLE_ADC_HZ = 8000000 / 128 / 13; // ~4808 conversions/s
// loop() has no timer; it runs as fast as the ISR leaves room for.
const KASTLE_LOOP_HZ = 10000;
const K_PITCH = 3, K_WS1 = 2, K_WS2 = 1; // ADC channels: PITCH, DRUM (WS_1), DECAY (WS_2)
const LOW_THRES = 150, HIGH_THRES = 162;
const ADC_SEQUENCE = [0, 1, 0, 2, 0, 3];
const SINE_HALF = [
  0, 0, 0, 0, 1, 1, 1, 2, 2, 3, 4, 5, 5, 6, 7, 9, 10, 11, 12, 14, 15, 17, 18, 20, 21, 23, 25, 27, 29, 31, 33, 35, 37, 40, 42, 44, 47, 49, 52, 54, 57, 59, 62, 65, 67, 70, 73, 76, 79, 82, 85, 88, 90, 93, 97, 100, 103, 106, 109, 112, 115, 118, 121, 124,
  128, 131, 134, 137, 140, 143, 146, 149, 152, 155, 158, 162, 165, 167, 170, 173, 176, 179, 182, 185, 188, 190, 193, 196, 198, 201, 203, 206, 208, 211, 213, 215, 218, 220, 222, 224, 226, 228, 230, 232, 234, 235, 237, 238, 240, 241, 243, 244, 245, 246, 248, 249, 250, 250, 251, 252, 253, 253, 254, 254, 254, 255, 255, 255,
];
const WAVETABLE = (() => {
  // writeWave(0) -> sineWave(): 128 table values, then mirrored.
  const wt = new Uint8Array(256);
  for (let i = 0; i < 128; i++) wt[i] = SINE_HALF[i];
  wt[128] = 255;
  for (let i = 129; i < 256; i++) wt[i] = wt[256 - i];
  return wt;
})();
const FLASH_SIZE = 16384 + 512;

function buildFlash(tables) {
  // Lay the sample tables out back to back like PROGMEM, then fill the rest
  // with deterministic pseudo-random "program bytes": the firmware's NOISE mode
  // can read far past the end of its table when DECAY is low.
  const flash = new Int8Array(FLASH_SIZE);
  const layout = {};
  let off = 0;
  for (const t of tables) {
    layout[t.name] = { off, len: t.data.length };
    for (let i = 0; i < t.data.length && off + i < FLASH_SIZE; i++) flash[off + i] = t.data[i];
    off += t.data.length;
  }
  let seed = 0x2f6b;
  for (let i = off; i < FLASH_SIZE; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    // AVR opcodes are word-aligned and biased toward a few prefixes.
    flash[i] = ((i & 1) ? (seed >> 16) & 0x9f : (seed >> 8) & 0xff) << 24 >> 24;
  }
  return { flash, layout };
}

class KastleChip {
  constructor(sr, tables) {
    this.sr = sr;
    const { flash, layout } = buildFlash(tables);
    this.flash = flash;
    const pick = (name, fallback) => layout[name] || layout[fallback] || { off: 0, len: 1 };
    this.tHH = pick('TR_HH');
    this.tKick = pick('KICK2', 'TR_HH');
    this.tSnare = pick('SNARE2', 'TR_HH');
    this.tClap = pick('TR_CLAP', 'TR_HH');
    this.wt = WAVETABLE;

    this.analog = new Int32Array(4); // the 8-bit ADC readings
    this.target = new Float64Array(4); // continuous "voltages" at the pins (0..255)
    this.qnt = false; // enhanced: scale-quantised pitch
    this.qntHz = 110;
    this.qntHzTarget = 110;
    this.xy = false; // NOISES output carries the envelope (firmware XY mode)
    this.decayMul = 1; // enhanced: decay range multiplier

    this.mode = 0;
    this.freq = 1; this.freq2 = 1; this.freq4 = 512;
    this.phase = 0; this.phase2 = 0; this.phase3 = 0; this.phase4 = 0;
    this.sample = 0; this.sample2 = 0;
    this.dv = 0; this.dv2 = 0; // decayVolume, decayVolume2
    this.decayTime = 50; this.pitchEnv = 0;
    this.dc1 = 0; this.dc2 = 0;
    this.trigState = 0;
    this.adcIdx = 0; this.adcDiscard = false;
    this.isrAcc = 0; this.loopAcc = 0; this.adcAcc = 0;

    this.pwmPh = 0;
    this.lp1 = 0; this.lp2 = 0;
    this.hp1x = 0; this.hp1y = 0; this.hp2x = 0; this.hp2y = 0;
    this.out = 0; this.noise = 0;
    this.lpA = 1 - Math.exp(-TAU * 7000 / sr);
    this.lpA7 = 1 - Math.exp(-TAU * 12000 / sr);
    this.hpR = Math.exp(-TAU * 14 / sr);
  }

  boot() {
    for (let i = 0; i < 4; i++) this.analog[i] = clamp(Math.round(this.target[i]), 0, 255);
    this.setFrequency2(this.analog[K_WS1] << 2);
    this.setFrequency(this.analog[K_PITCH] << 2);
    this.setDecay();
    const v = this.analog[0];
    this.trigState = v < LOW_THRES ? 0 : v > HIGH_THRES ? 2 : 1;
  }

  // ---- firmware functions -------------------------------------------------
  setFrequency2(input) {
    const newMode = input >> 7;
    const changed = newMode !== this.mode;
    this.mode = newMode;
    this.freq2 = ((input << 4) + 1) & 0xffff;
    this.freq4 = (512 - input) & 0xffff;
    // The firmware only recalculates pitch when PITCH moves; real ADC jitter
    // makes that happen constantly, so we refresh it on drum-style changes.
    if (changed) this.setFrequency(this.analog[K_PITCH] << 2);
  }

  setFrequency(input) {
    if (this.qnt) {
      const hz = this.qntHz;
      if (this.mode === 0) this.freq = hz * 65536 / KASTLE_ISR_HZ / 4; // FM wraps 4x per phase cycle
      else if (this.mode === 2) this.freq = hz * 65536 / KASTLE_ISR_HZ;
      else if (this.mode === 1) this.freq = 4.19 * hz / 130.81; // sample read at phase>>2
      else this.freq = 8.39 * hz / 130.81; // sample read at phase>>3, C3 = native rate
      return;
    }
    if (this.mode === 1) this.freq = (((input - 200) << 2) + 1) & 0xffff;
    else if (this.mode > 3) this.freq = input + 1;
    else this.freq = ((input << 2) + 1) & 0xffff;
  }

  setDecay() {
    const w = this.analog[K_WS2];
    if (w > 100) { this.decayTime = clamp(w - 120, 1, 255); this.pitchEnv = 0; }
    else { this.decayTime = 100 - w; this.pitchEnv = 255; }
  }

  trigger(a, b) {
    if (Math.abs(a - b) === 1) { this.dv = 128; this.dv2 = 255; }
    else { this.dv = 255; this.dv2 = 150; }
  }

  trigDetect() {
    const v = this.analog[0];
    const last = this.trigState;
    const st = v < LOW_THRES ? 0 : v > HIGH_THRES ? 2 : 1;
    if (st !== last) { this.trigState = st; this.trigger(st, last); this.phase = 0; }
  }

  hit(strong) {
    this.trigger(strong ? 2 : 1, 0);
    this.phase = 0;
  }

  isr() {
    const add = this.pitchEnv ? this.dv : 0;
    this.phase = (this.phase + this.freq + add) % 65536;
    this.phase3 = (this.phase3 + this.freq + add) % 256;
    this.phase2 = (this.phase2 + this.freq2 + add) & 0xffff;
    const ph = Math.floor(this.phase);
    if ((ph & 3) === 0) this.phase4 = (this.phase4 + this.freq4) & 0xffff;
    if (this.mode === 0) {
      // FM: _phs = (_phase + WS_2 * wavetable[_phase2 >> 8]) >> 6, truncated to 8 bits
      const phs = (((ph + this.analog[K_WS2] * this.wt[this.phase2 >> 8]) & 0xffff) >> 6) & 0xff;
      this.sample = (this.wt[phs] * this.dv) >> 8;
    }
  }

  synthesis() {
    const a = this.analog;
    const fl = this.flash;
    if (this.xy) {
      this.sample2 = this.dv;
    } else {
      if ((Math.floor(this.phase3) >> 2) >= (a[K_WS1] << 4)) this.phase3 = 0;
      const last = this.sample2;
      let s2 = (fl[this.tHH.off + Math.floor(this.phase3)] + 128) & 0xff;
      if (a[K_PITCH] > this.wt[((this.phase4 >> 9) + (s2 >> 5)) & 0xff]) s2 = last;
      else s2 = Math.abs(s2 - last);
      this.sample2 = (s2 * this.dv2) >> 8;
    }
    const m = this.mode;
    if (m === 1) {
      // NOISE: hi-hat sample (read as unsigned), ring-modulated by the sine osc
      const lim = ((a[K_WS2] - 100) << 5) & 0xffff; // int compared as unsigned int
      if ((Math.floor(this.phase) >> 2) >= lim) this.phase = 0;
      let s = fl[this.tHH.off + (Math.floor(this.phase) >> 2)] & 0xff;
      s = (s * this.wt[this.phase2 >> 8]) >> 8;
      this.sample = (s * this.dv) >> 8;
    } else if (m === 2) {
      // TAH: track & hold of the sine, gated by the second phase
      if ((this.phase2 >> 8) < a[K_WS2] + 5) {
        this.sample = (this.wt[Math.floor(this.phase) >> 8] * this.dv) >> 8;
      }
    } else if (m >= 3) {
      let t, plus;
      if (m === 3) { t = this.tKick; plus = 128; }
      else if (m === 4) { t = this.tSnare; plus = 0; }
      else if (m === 6) { t = this.tHH; plus = 0; }
      else { t = this.tClap; plus = 128; }
      if ((Math.floor(this.phase) >> 3) > t.len) this.phase = 0;
      const s = (fl[t.off + (Math.floor(this.phase) >> 3)] + plus) & 0xff;
      this.sample = (s * this.dv) >> 8;
    }
  }

  renderDecay() {
    if (this.decayTime === 0) return; // DECAY at exactly 100: the envelope holds
    const inc = 6 / this.decayMul;
    this.dc1 += inc;
    if (this.dc1 >= this.decayTime) { this.dc1 = 0; if (this.dv > 0) this.dv -= (this.dv >> 6) + 1; }
    this.dc2 += inc;
    if (this.dc2 >= this.decayTime) { this.dc2 = 0; if (this.dv2 > 0) this.dv2 -= (this.dv2 >> 6) + 1; }
  }

  adc() {
    // Every other conversion is thrown away (multiplexer crosstalk), as in the firmware.
    if (this.adcDiscard) { this.adcDiscard = false; return; }
    this.adcDiscard = true;
    const ch = ADC_SEQUENCE[this.adcIdx];
    this.adcIdx = (this.adcIdx + 1) % ADC_SEQUENCE.length;
    const prev = this.analog[ch];
    const nv = clamp(Math.round(this.target[ch]), 0, 255);
    this.analog[ch] = nv;
    if (ch === 0) { this.trigDetect(); return; }
    if (ch === K_PITCH) {
      const qChanged = this.qnt && this.qntHz !== this.qntHzTarget;
      if (qChanged) this.qntHz = this.qntHzTarget;
      if (prev !== nv || qChanged) {
        this.setFrequency(nv << 2);
        // "acceleration charge": movement on PITCH pumps the NOISES envelope
        this.dv2 = Math.min(255, this.dv2 + (Math.abs(prev - nv) << 3));
      }
    } else if (ch === K_WS1) {
      if (prev !== nv) {
        this.setFrequency2(nv << 2);
        // movement on DRUM pumps the main envelope
        this.dv = Math.min(255, this.dv + (Math.abs(prev - nv) << 2));
      }
    } else if (ch === K_WS2) {
      if (prev !== nv) this.setDecay();
    }
  }

  tick() {
    const sr = this.sr;
    this.adcAcc += KASTLE_ADC_HZ / sr;
    while (this.adcAcc >= 1) { this.adcAcc -= 1; this.adc(); }
    this.isrAcc += KASTLE_ISR_HZ / sr;
    while (this.isrAcc >= 1) { this.isrAcc -= 1; this.isr(); }
    this.loopAcc += KASTLE_LOOP_HZ / sr;
    while (this.loopAcc >= 1) { this.loopAcc -= 1; this.synthesis(); this.renderDecay(); }

    let o1, o2, a;
    if (this.mode === 7) {
      // DRUM style 8 drops Timer0's PWM carrier to 3.9 kHz: the carrier is audible.
      this.pwmPh += 3906.25 / sr;
      if (this.pwmPh >= 1) this.pwmPh -= 1;
      o1 = this.pwmPh < this.sample / 256 ? 1 : 0;
      o2 = this.pwmPh < this.sample2 / 256 ? 1 : 0;
      a = this.lpA7;
    } else {
      o1 = this.sample / 255;
      o2 = this.sample2 / 255;
      a = this.lpA;
    }
    // output RC low-pass, then the coupling capacitor (DC blocker)
    this.lp1 += (o1 * 2 - 1 - this.lp1) * a;
    this.lp2 += (o2 * 2 - 1 - this.lp2) * a;
    const y1 = this.lp1 - this.hp1x + this.hpR * this.hp1y; this.hp1x = this.lp1; this.hp1y = y1;
    const y2 = this.lp2 - this.hp2x + this.hpR * this.hp2y; this.hp2x = this.lp2; this.hp2y = y2;
    this.out = y1;
    this.noise = y2;
  }
}

// ---------------------------------------------------------------------------
// Clock / LFO / stepped voltage chip
// ---------------------------------------------------------------------------
class ClockChip {
  constructor(sr) {
    this.sr = sr;
    this.phase = 0;
    this.sq = 0; this.tri = 0;
    this.hz = 2;
    this.steps = new Float64Array(16);
    for (let i = 0; i < 16; i++) this.steps[i] = Math.random();
    this.pos = 0;
    this.stepRaw = this.steps[0];
    this.step = this.stepRaw;
    this.lastClkIn = 0;
    this.edge = false; // rising edge of the clock this sample
  }

  regenerate() { for (let i = 0; i < 16; i++) this.steps[i] = Math.random(); }

  process(hz, running, stepMode, stepClkIn, stepClkPatched, glide) {
    this.hz = hz;
    this.edge = false;
    if (running) {
      this.phase += hz / this.sr;
      if (this.phase >= 1) { this.phase -= Math.floor(this.phase); this.edge = true; }
    }
    this.sq = running && this.phase < 0.5 ? 1 : 0;
    this.tri = this.phase < 0.5 ? this.phase * 2 : 2 - this.phase * 2;

    const clkIn = stepClkPatched ? (stepClkIn > 0.5 ? 1 : 0) : this.sq;
    const rising = stepClkPatched ? (clkIn && !this.lastClkIn) : this.edge;
    this.lastClkIn = clkIn;
    if (rising) {
      if (stepMode === 0) {
        // random: a fresh voltage each step, written into the loop memory
        this.pos = (this.pos + 1) % 16;
        this.steps[this.pos] = Math.random();
      } else {
        const len = stepMode === 1 ? 8 : 16;
        this.pos = (this.pos + 1) % len;
      }
      this.stepRaw = this.steps[this.pos];
    }
    if (glide > 0) {
      const tc = 0.001 + glide * glide * 0.6;
      this.step += (this.stepRaw - this.step) * (1 - Math.exp(-1 / (tc * this.sr)));
    } else {
      this.step = this.stepRaw;
    }
  }
}

// ---------------------------------------------------------------------------
// Wingie2 resonator
// ---------------------------------------------------------------------------
const W_POLY = 0, W_STRING = 1, W_BAR = 2, W_CAVE = 3, W_RATIO = 4;
const N_RES = 9;
const MODAL_BLOCK = 32;
const BAR_FACTOR = 0.44444;
const BASE_NOTE = 48;

function tau2pole(t, sr) { return Math.exp(-1 / (t * sr)); }

class WingieSide {
  constructor(sr) {
    this.q = new Float64Array(N_RES);
    this.p = new Float64Array(N_RES);
    this.peak = new Float64Array(N_RES);
    this.c = new Float64Array(N_RES);
    this.s = new Float64Array(N_RES);
    this.rho = new Float64Array(N_RES);
    this.inGain = new Float64Array(N_RES).fill(1);
    this.scale = new Float64Array(N_RES).fill(2);
    this.gain = new Float64Array(N_RES).fill(1);
    this.gainT = new Float64Array(N_RES).fill(1);
    this.freq = new Float64Array(N_RES).fill(100);
    this.energy = new Float64Array(N_RES);
    // fi.lowpass(1, 4000): bilinear first-order Butterworth
    const k = Math.tan(Math.PI * 4000 / sr);
    this.lpB = k / (1 + k);
    this.lpA = (k - 1) / (k + 1);
    this.lpX = 0; this.lpY = 0;
    this.dcX = 0; this.dcY = 0; // dcblocker after the cubic clipper
    this.inDcX = 0; this.inDcY = 0; // fi.dcblocker at the input
    this.fol = 0; this.trig = false; this.trigPeak = 0; this.armLevel = 0; this.holdoff = 0;
    this.seqIdx = 0;
    this.note = BASE_NOTE;
  }
}

class Wingie {
  constructor(sr, tunings) {
    this.sr = sr;
    this.L = new WingieSide(sr);
    this.R = new WingieSide(sr);
    this.sides = [this.L, this.R];
    this.tunings = tunings || [];
    this.folPole = tau2pole(0.025, sr);
    this.holdoff = Math.floor(0.03 * sr); // min 30 ms between sequencer advances
    this.dcR = 1 - TAU * 35 / sr; // fi.dcblocker ~ 35 Hz one-zero/one-pole
    this.state = {
      mode: [W_STRING, W_BAR],
      oct: [0, 0],
      poly: [[48, 52, 55], [60, 64, 67]],
      ratioNotes: [[48, 52, 55], [60, 64, 67]],
      seq: [[0], [0]],
      cave: [
        [[62, 115, 218, 411, 777, 1500, 2800, 5200, 11000], [205, 304, 370, 523, 540, 800, 913, 1568, 2400], [212, 425, 531, 637, 1168, 2017, 2336, 2654, 3693]],
        [[62, 115, 218, 411, 777, 1500, 2800, 5200, 11000], [205, 304, 370, 523, 540, 800, 913, 1568, 2400], [212, 425, 531, 637, 1062, 2017, 2336, 2654, 3693]],
      ],
      caveMute: [
        [new Array(9).fill(false), new Array(9).fill(false), new Array(9).fill(false)],
        [new Array(9).fill(false), new Array(9).fill(false), new Array(9).fill(false)],
      ],
      ratios: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    };
    this.blockCount = 0;
    this.advanceCount = [0, 0];
  }

  setState(st, resetSeq) {
    const s = this.state;
    for (const key of Object.keys(st)) if (key in s) s[key] = st[key];
    for (let ch = 0; ch < 2; ch++) {
      const len = s.seq[ch].length || 1;
      if (resetSeq && resetSeq[ch]) this.sides[ch].seqIdx = 0;
      if (this.sides[ch].seqIdx >= len) this.sides[ch].seqIdx = 0;
    }
  }

  advance(ch) {
    const s = this.state;
    const m = s.mode[ch];
    if (m !== W_STRING && m !== W_BAR) return;
    const seq = s.seq[ch];
    if (seq.length < 2) return; // TapSequence::hasCycle()
    const side = this.sides[ch];
    side.seqIdx = (side.seqIdx + 1) % seq.length;
    this.advanceCount[ch]++;
  }

  noteFreq(note, a3, tuning) {
    if (tuning >= 0 && this.tunings[tuning]) {
      let deg = note % 12; if (deg < 0) deg += 12;
      return a3 * Math.pow(2, (note - deg - 69) / 12) * this.tunings[tuning][deg];
    }
    return a3 * Math.pow(2, (note - 69) / 12);
  }

  computeFreqs(ch, P, semis) {
    const s = this.state;
    const side = this.sides[ch];
    const m = s.mode[ch];
    const a3 = P['w.a3'];
    const tun = P['w.tuning'];
    const f = side.freq;
    const g = side.gainT;
    g.fill(1);
    if (m === W_POLY || m === W_RATIO) {
      const notes = m === W_POLY ? s.poly[ch] : s.ratioNotes[ch];
      for (let v = 0; v < 3; v++) {
        const base = this.noteFreq(notes[v] + semis, a3, tun);
        for (let k = 0; k < 3; k++) {
          const i = v * 3 + k;
          f[i] = base * (m === W_POLY ? k + 1 : s.ratios[i]);
        }
      }
      side.note = notes[0] + semis;
    } else if (m === W_STRING || m === W_BAR) {
      const seq = s.seq[ch];
      const n = (seq[side.seqIdx] || 0) + BASE_NOTE + s.oct[ch] * 12 + (ch ? 12 : 0) + semis;
      side.note = n;
      const base = this.noteFreq(n, a3, tun);
      for (let i = 0; i < N_RES; i++) {
        if (m === W_STRING) f[i] = base * (i + 1);
        else { const b = i + 1.5; f[i] = base * BAR_FACTOR * b * b; }
      }
    } else {
      const bank = clamp(s.oct[ch] + 1, 0, 2);
      const ratio = Math.pow(2, semis / 12);
      for (let i = 0; i < N_RES; i++) {
        f[i] = s.cave[ch][bank][i] * ratio;
        g[i] = s.caveMute[ch][bank][i] ? 0 : 1;
      }
      side.note = -1;
    }
    const fmax = Math.min(16000, this.sr * 0.45);
    for (let i = 0; i < N_RES; i++) {
      f[i] = clamp(f[i], 16, fmax);
      if (f[i] >= fmax) g[i] = 0; // nothing above Nyquist-ish
    }
  }

  // Block-rate coefficient + anti-feedback update (modalBlockSize = 32)
  updateCoeffs(ch, t60, guardOn, energyLimit, rhoGuard) {
    const side = this.sides[ch];
    const rhoUser = Math.pow(0.001, 1 / (t60 * this.sr));
    for (let i = 0; i < N_RES; i++) {
      const th = TAU * side.freq[i] / this.sr;
      side.c[i] = Math.cos(th);
      side.s[i] = Math.sin(th);
      const overload = Math.max(1, side.peak[i] / energyLimit);
      side.energy[i] = side.peak[i];
      if (guardOn && overload > 1) {
        side.inGain[i] = 1 / overload;
        side.rho[i] = Math.min(rhoUser, rhoGuard);
      } else {
        side.inGain[i] = 1;
        side.rho[i] = rhoUser;
      }
      side.scale[i] = 2 / rhoUser;
      side.peak[i] = 0;
    }
  }

  // One sample for one side. x = input after volume. Returns wet signal.
  resonate(side, x, muteStep) {
    // resonator_input_gain (0.5 -> lin2LogGain = 0.25) then fi.lowpass(1, 4000)
    const xi = x * 0.25;
    const y = side.lpB * xi + side.lpB * side.lpX - side.lpA * side.lpY;
    side.lpX = xi; side.lpY = y;
    let sum = 0;
    const q = side.q, p = side.p;
    for (let i = 0; i < N_RES; i++) {
      const gt = side.gainT[i];
      let gc = side.gain[i];
      if (gc !== gt) { gc = gt > gc ? Math.min(gt, gc + muteStep) : Math.max(gt, gc - muteStep); side.gain[i] = gc; }
      const r = side.rho[i], c = side.c[i], s = side.s[i];
      const qn = r * (s * p[i] + c * q[i]);
      const pn = side.inGain[i] * y + r * (c * p[i] - s * q[i]);
      q[i] = qn; p[i] = pn;
      const e = qn * qn + pn * pn;
      if (e > side.peak[i]) side.peak[i] = e;
      sum += qn * side.scale[i] * gc * gc; // env_mute -> lin2LogGain
    }
    return sum;
  }

  panic() {
    for (const side of this.sides) { side.q.fill(0); side.p.fill(0); side.peak.fill(0); }
  }
}

// ef.cubicnl(0.01, 0) without its dcblocker (applied separately)
const CUBIC_PRE = Math.pow(10, 2 * 0.01);
function cubicnl(x) {
  let v = x * CUBIC_PRE;
  v = v > 1 ? 1 : v < -1 ? -1 : v;
  return v - (v * v * v) / 3;
}

// ---------------------------------------------------------------------------
// Filters, shapers, effects
// ---------------------------------------------------------------------------
class SVF {
  // Cytomic TPT state-variable filter
  constructor() { this.ic1 = 0; this.ic2 = 0; this.a1 = 0; this.a2 = 0; this.a3 = 0; this.k = 2; }
  set(g, k) {
    this.k = k;
    this.a1 = 1 / (1 + g * (g + k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
  lp(v0) {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1; this.ic2 = 2 * v2 - this.ic2;
    return v2;
  }
  hp(v0) {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1; this.ic2 = 2 * v2 - this.ic2;
    return v0 - this.k * v1 - v2;
  }
  reset() { this.ic1 = 0; this.ic2 = 0; }
}

function triFold(x) {
  // fold into [-1, 1]
  const t = (x + 1) * 0.25;
  const f = t - Math.floor(t);
  return f < 0.5 ? f * 4 - 1 : 3 - f * 4;
}

function fastTanh(x) {
  if (x > 4.97) return 1;
  if (x < -4.97) return -1;
  const x2 = x * x;
  return x * (135135 + x2 * (17325 + x2 * (378 + x2))) / (135135 + x2 * (62370 + x2 * (3150 + x2 * 28)));
}

function tube(x, g) { return x >= 0 ? fastTanh(x * g) : (fastTanh(x * g * 0.55) / 0.55) * 0.8; }
function fuzz(x, g) { const v = clamp(x * g, -1, 1); return v * 0.6 + Math.abs(v) * 0.6 - 0.3; }

class TapeEcho {
  constructor(sr) {
    this.sr = sr;
    this.size = Math.ceil(sr * 4.2);
    this.bufL = new Float32Array(this.size);
    this.bufR = new Float32Array(this.size);
    this.w = 0;
    this.time = sr * 0.3; // smoothed delay in samples
    this.lpL = 0; this.lpR = 0; this.hpL = 0; this.hpR = 0;
    this.wow = 0; this.flut = 0;
  }
  read(buf, d) {
    let r = this.w - d;
    while (r < 0) r += this.size;
    const i0 = Math.floor(r);
    const fr = r - i0;
    const i1 = (i0 + 1) % this.size;
    return buf[i0] + (buf[i1] - buf[i0]) * fr;
  }
  clear() { this.bufL.fill(0); this.bufR.fill(0); }
}

class FDNReverb {
  constructor(sr) {
    this.sr = sr;
    const base = [1031, 1327, 1523, 1871, 2053, 2311, 2647, 2953];
    this.base = base.map((b) => (b * sr) / 48000);
    this.maxLen = this.base.map((b) => Math.ceil(b * 2.05) + 4);
    this.buf = this.maxLen.map((n) => new Float32Array(n));
    this.w = new Int32Array(8);
    this.len = new Float64Array(8);
    this.g = new Float64Array(8);
    this.lp = new Float64Array(8);
    this.o = new Float64Array(8);
    this.size = -1; this.damp = -1;
    this.dampA = 0.5;
    this.pre = new Float32Array(Math.ceil(sr * 0.05));
    this.preW = 0;
  }
  configure(size, damp) {
    if (Math.abs(size - this.size) < 1e-4 && Math.abs(damp - this.damp) < 1e-4) return;
    this.size = size; this.damp = damp;
    const scale = 0.25 + size * 1.75;
    const rt = 0.4 + size * size * 11;
    for (let i = 0; i < 8; i++) {
      this.len[i] = Math.min(this.maxLen[i] - 2, this.base[i] * scale);
      this.g[i] = Math.pow(10, (-3 * this.len[i]) / (rt * this.sr));
    }
    const fc = 18000 * Math.pow(0.04, damp);
    this.dampA = 1 - Math.exp((-TAU * fc) / this.sr);
  }
  clear() { for (const b of this.buf) b.fill(0); this.lp.fill(0); this.pre.fill(0); }
}

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------
const DEFAULT_PARAMS = {
  'k.drum': 0.04, 'k.pitch': 0.4, 'k.decay': 0.62,
  'k.qnt': 0, 'k.xy': 0, 'k.range': 2, 'k.outLvl': 0.85, 'k.noiseLvl': 0.25,
  'c.rate': 0.5, 'c.bpm': 120, 'c.lock': 0, 'c.run': 1, 'c.mode': 2, 'c.glide': 0,
  'u.drift': 0.3,
  's.drive': 0.1, 's.fold': 0, 's.crush': 0, 's.down': 0, 's.feed': 0,
  'w.mix': 0.8, 'w.decay': 0.5, 'w.vol': 0.7, 'w.threshL': 0.1, 'w.threshR': 0.1,
  'w.pre': 0.5, 'w.post': 0.5, 'w.tuning': -1, 'w.a3': 440, 'w.guard': 1, 'w.hold': 0,
  'f.hp': 0.1, 'f.hpRes': 0.1, 'f.lp': 0.85, 'f.lpRes': 0.2, 'f.slope': 1,
  'x.type': 0, 'x.amt': 0.15,
  'd.time': 0.5, 'd.sync': 3, 'd.fb': 0.4, 'd.tone': 0.55, 'd.wow': 0.25, 'd.mix': 0.25, 'd.pp': 1,
  'r.size': 0.55, 'r.damp': 0.45, 'r.mix': 0.2,
  'm.vol': 0.6,
  'g.root': 9, 'g.scale': 0,
};
for (const d of DESTS) DEFAULT_PARAMS['amt.' + d] = 0.5;
// gate inputs pass full level by default
DEFAULT_PARAMS['amt.k.trig'] = 1; DEFAULT_PARAMS['amt.c.stepclk'] = 1; DEFAULT_PARAMS['amt.w.adv'] = 1;

const SYNC_TICKS = [0, 1, 2, 3, 4, 6, 8, 12, 16];

// ---------------------------------------------------------------------------
// The processor
// ---------------------------------------------------------------------------
class HarmonicPulseProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    const sr = sampleRate;
    this.sr = sr;
    this.P = Object.assign({}, DEFAULT_PARAMS);
    this.scales = opts.scales || [[0, 3, 5, 7, 10]];
    this.kastle = new KastleChip(sr, opts.tables || []);
    this.clock = new ClockChip(sr);
    this.wingie = new Wingie(sr, opts.tunings || []);
    this.echo = new TapeEcho(sr);
    this.verb = new FDNReverb(sr);
    this.hpL = new SVF(); this.hpR = new SVF();
    this.lpL1 = new SVF(); this.lpL2 = new SVF(); this.lpR1 = new SVF(); this.lpR2 = new SVF();

    this.src = new Float64Array(SOURCES.length);
    this.dst = new Float64Array(DESTS.length);
    this.patched = new Uint8Array(DESTS.length);
    this.amt = new Float64Array(DESTS.length);
    this.cables = []; // [srcIdx, dstIdx]

    this.divCount = 0;
    this.drift = { a: Math.random(), b: Math.random(), t: 0 };
    this.lastAdv = 0;

    // per-sample smoothed parameters
    this.smoothIds = ['k.outLvl', 'k.noiseLvl', 's.drive', 'w.mix', 'w.vol', 'w.pre', 'w.post',
      'f.hp', 'f.lp', 'f.hpRes', 'f.lpRes', 'x.amt', 'd.mix', 'd.fb', 'd.tone', 'r.mix', 'm.vol', 'k.pitch', 'k.drum', 'k.decay'];
    this.sm = {};
    for (const id of this.smoothIds) this.sm[id] = this.P[id];
    this.smA = 1 - Math.exp(-4 / (0.012 * sr)); // updated every 4 samples

    this.crushHoldL = 0; this.crushHoldR = 0; this.crushCnt = 0;
    this.colorDcL = [0, 0]; this.colorDcR = [0, 0];
    this.limEnv = 0;
    this.meterAcc = 0;
    this.meterEvery = Math.floor(sr / 30);
    this.peakL = 0; this.peakR = 0;
    this.wEnv = 0;
    this.recording = false;
    this.recBuf = null; this.recPos = 0;
    this.errored = false;
    this.t = 0;

    this.applyKastleTargets();
    this.kastle.boot();

    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'params':
        for (const [k, v] of Object.entries(msg.values || {})) {
          if (k in this.P && typeof v === 'number' && Number.isFinite(v)) this.P[k] = v;
        }
        break;
      case 'cables':
        this.cables = [];
        this.patched.fill(0);
        for (const [from, to] of msg.cables || []) {
          if (from in SRC && to in DST) { this.cables.push([SRC[from], DST[to]]); this.patched[DST[to]] = 1; }
        }
        break;
      case 'wingie':
        this.wingie.setState(msg.state || {}, msg.resetSeq);
        break;
      case 'hit':
        this.kastle.hit(msg.strong !== false);
        break;
      case 'advance':
        this.wingie.advance(0); this.wingie.advance(1);
        break;
      case 'regen':
        this.clock.regenerate();
        break;
      case 'panic':
        this.wingie.panic(); this.echo.clear(); this.verb.clear();
        break;
      case 'rec':
        this.recording = !!msg.on;
        if (this.recording) { this.recBuf = new Float32Array(8192); this.recPos = 0; }
        else if (this.recBuf) { this.flushRec(); this.recBuf = null; }
        break;
      default:
        break;
    }
  }

  flushRec() {
    if (!this.recBuf || this.recPos === 0) return;
    const chunk = this.recBuf.slice(0, this.recPos);
    this.port.postMessage({ type: 'rec', data: chunk }, [chunk.buffer]);
    this.recPos = 0;
  }

  quantize(semisFloat) {
    // nearest note of the global scale (relative to the root) at or below + rounding
    const scale = this.scales[this.P['g.scale'] | 0] || this.scales[0];
    const root = this.P['g.root'] | 0;
    const target = semisFloat;
    let best = 0, bestD = 1e9;
    const oct0 = Math.floor((target - root) / 12) - 1;
    for (let o = oct0; o <= oct0 + 2; o++) {
      for (const deg of scale) {
        const n = root + deg + o * 12;
        const d = Math.abs(n - target);
        if (d < bestD) { bestD = d; best = n; }
      }
    }
    return best;
  }

  applyKastleTargets() {
    const P = this.P, k = this.kastle, sm = this.sm, D = this.dst, pt = this.patched;
    const trigV = pt[DST['k.trig']] ? D[DST['k.trig']] : 0;
    k.target[0] = clamp(trigV, 0, 1) * 255;
    k.target[K_WS2] = clamp(sm['k.decay'] + D[DST['k.decay']], 0, 1) * 255;
    k.target[K_WS1] = clamp(sm['k.drum'] + D[DST['k.drum']], 0, 1) * 255;
    const pv = clamp(sm['k.pitch'] + D[DST['k.pitch']], 0, 1);
    k.target[K_PITCH] = pv * 255;
    k.qnt = P['k.qnt'] > 0.5;
    if (k.qnt) {
      // 4 octaves from the scale root at C1..B1, quantised to the global scale
      const root = P['g.root'] | 0;
      const n = this.quantize(24 + root + pv * 48);
      k.qntHzTarget = 440 * Math.pow(2, (n - 69) / 12);
    }
    k.xy = P['k.xy'] > 0.5;
    k.decayMul = clamp(P['k.range'], 0.25, 16);
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const oL = out[0];
    const oR = out[1] || out[0];
    const n = oL.length;
    if (this.errored) { oL.fill(0); if (oR !== oL) oR.fill(0); return true; }
    try {
      this.render(oL, oR, n);
    } catch (err) {
      this.errored = true;
      this.port.postMessage({ type: 'error', message: String(err && err.stack || err) });
      oL.fill(0); if (oR !== oL) oR.fill(0);
    }
    return true;
  }

  render(oL, oR, n) {
    const P = this.P, sm = this.sm, smA = this.smA, sr = this.sr;
    const src = this.src, dst = this.dst, cables = this.cables, pt = this.patched;
    const k = this.kastle, clk = this.clock, w = this.wingie, ec = this.echo, rv = this.verb;
    const S = SRC, D = DST;
    const amt = this.amt;
    for (let d = 0; d < DESTS.length; d++) amt[d] = P[AMT_KEYS[d]];

    // block-constant values
    const stepMode = P['c.mode'] | 0;
    const running = P['c.run'] > 0.5;
    const glide = P['c.glide'];
    const feedSplit = P['s.feed'] > 0.5;
    const crush = P['s.crush'];
    const bits = 16 - crush * 13;
    const qStep = crush > 0.001 ? Math.pow(2, bits - 1) : 0;
    const downN = 1 + Math.floor(P['s.down'] * P['s.down'] * 47);
    const colorType = P['x.type'] | 0;
    const slope24 = P['f.slope'] > 0.5;
    const muteStep = 1 / (0.25 * sr);
    const guardOn = P['w.guard'] > 0.5;
    const driftHz = 0.02 * Math.pow(150, P['u.drift']);
    const syncTicks = SYNC_TICKS[P['d.sync'] | 0] || 0;
    const pingpong = P['d.pp'] > 0.5;
    const wowDepth = P['d.wow'];
    const fmax = sr * 0.45;
    rv.configure(P['r.size'], P['r.damp']);
    const smoothIds = this.smoothIds;

    for (let i = 0; i < n; i++) {
      // control-rate work (every 4 samples): smoothing, Kastle pin voltages, filter coefficients
      const ctl = (i & 3) === 0;
      if (ctl) {
        for (let j = 0; j < smoothIds.length; j++) {
          const id = smoothIds[j];
          sm[id] += (P[id] - sm[id]) * smA;
        }
      }

      // ---- patch bay: sum sources into destinations (one-sample feedback) ----
      dst.fill(0);
      for (let c = 0; c < cables.length; c++) {
        const cb = cables[c];
        dst[cb[1]] += src[cb[0]];
      }
      for (let d = 0; d < dst.length; d++) dst[d] *= amt[d];

      // ---- clock chip ----
      let hz;
      if (P['c.lock'] > 0.5) hz = (P['c.bpm'] / 60) * 4; // clock = 16th notes
      else hz = 0.25 * Math.pow(128, clamp(P['c.rate'] + dst[D['c.rate']], 0, 1));
      clk.process(hz, running, stepMode, dst[D['c.stepclk']], pt[D['c.stepclk']] === 1, glide);
      if (clk.edge) this.divCount++;
      const dc = this.divCount, sq = clk.sq;

      // ---- utility: dividers + drift ----
      const dr = this.drift;
      dr.t += driftHz / sr;
      if (dr.t >= 1) { dr.t -= 1; dr.a = dr.b; dr.b = Math.random(); }
      const driftV = dr.a + (dr.b - dr.a) * (0.5 - 0.5 * Math.cos(Math.PI * dr.t));

      // ---- Kastle Drum ----
      if (ctl) this.applyKastleTargets();
      k.tick();

      // ---- pre-shaper ----
      const kOut = k.out * sm['k.outLvl'];
      const kNoise = k.noise * sm['k.noiseLvl'];
      let inL, inR;
      if (feedSplit) { inL = kOut; inR = kNoise; } else { inL = inR = kOut + kNoise; }
      const drive = sm['s.drive'];
      if (drive > 0.001) {
        const g = 1 + drive * drive * 30;
        const norm = 1 / fastTanh(g);
        inL = fastTanh(inL * g) * norm;
        inR = fastTanh(inR * g) * norm;
      }
      const fold = clamp(P['s.fold'] + dst[D['s.fold']], 0, 1);
      if (fold > 0.001) {
        const g = 1 + fold * 7;
        inL = triFold(inL * g);
        inR = triFold(inR * g);
      }
      if (downN > 1) {
        if (this.crushCnt <= 0) { this.crushHoldL = inL; this.crushHoldR = inR; this.crushCnt = downN; }
        this.crushCnt--;
        inL = this.crushHoldL; inR = this.crushHoldR;
      }
      if (qStep > 0) {
        inL = Math.round(inL * qStep) / qStep;
        inR = Math.round(inR * qStep) / qStep;
      }

      // ---- Wingie ----
      if (w.blockCount === 0) {
        const decayKnob = clamp(P['w.decay'] + dst[D['w.decay']], 0, 1);
        const t60 = P['w.hold'] > 0.5 ? 60 : 0.1 * Math.pow(100, decayKnob);
        for (let ch = 0; ch < 2; ch++) {
          const noteDst = ch ? D['w.noteR'] : D['w.noteL'];
          let semis = 0;
          if (pt[noteDst]) {
            const side = w.sides[ch];
            const st = w.state;
            const m = st.mode[ch];
            let base;
            if (m === W_STRING || m === W_BAR) base = (st.seq[ch][side.seqIdx] || 0) + BASE_NOTE + st.oct[ch] * 12 + (ch ? 12 : 0);
            else if (m === W_POLY) base = st.poly[ch][0];
            else if (m === W_RATIO) base = st.ratioNotes[ch][0];
            else base = 48;
            semis = this.quantize(base + clamp(dst[noteDst], -1, 1) * 24) - base;
          }
          w.computeFreqs(ch, P, semis);
          w.updateCoeffs(ch, t60, guardOn, 1, 0.998435);
        }
      }
      w.blockCount = (w.blockCount + 1) % MODAL_BLOCK;

      // advance input (patch) — rising edge
      const adv = pt[D['w.adv']] ? dst[D['w.adv']] : 0;
      if (adv > 0.5 && this.lastAdv <= 0.5) { w.advance(0); w.advance(1); }
      this.lastAdv = adv;

      const vol = sm['w.vol'] * sm['w.vol'];
      const pre = sm['w.pre'] * sm['w.pre'];
      const post = sm['w.post'] * sm['w.post'];
      const mix = sm['w.mix'];
      let wl = 0, wr = 0;
      for (let ch = 0; ch < 2; ch++) {
        const side = w.sides[ch];
        const xr = ch ? inR : inL;
        // fi.dcblocker
        const xd = xr - side.inDcX + w.dcR * side.inDcY; side.inDcX = xr; side.inDcY = xd;
        // amp follower -> sequencer threshold
        const ax = Math.abs(xd);
        side.fol = Math.max(ax, ax * (1 - w.folPole) + w.folPole * side.fol);
        // Firmware: advance on each rising edge of (follower > threshold).
        // Overlapping Kastle hits rarely fall back under the threshold, so we
        // also re-arm on a relative drop and fire again on a fresh transient.
        const th = ch ? P['w.threshR'] : P['w.threshL'];
        if (side.holdoff > 0) side.holdoff--;
        if (side.trig) {
          if (side.fol > side.trigPeak) side.trigPeak = side.fol;
          if (side.fol < th) { side.trig = false; side.armLevel = 0; }
          else if (side.fol < side.trigPeak * 0.55) { side.trig = false; side.armLevel = side.fol; }
        } else if (side.armLevel > 0 && side.fol < side.armLevel) {
          side.armLevel = side.fol;
        }
        if (!side.trig && th < 0.999 && side.holdoff === 0 &&
            side.fol > th && side.fol > side.armLevel * 1.6) {
          side.trig = true; side.trigPeak = side.fol; side.holdoff = w.holdoff; w.advance(ch);
        }
        const x = xd * vol;
        const res = w.resonate(side, x, muteStep);
        let y = cubicnl(res * pre);
        const yd = y - side.dcX + w.dcR * side.dcY; side.dcX = y; side.dcY = yd;
        y = yd * mix * post + x * (1 - mix);
        if (ch) wr = y; else wl = y;
      }
      this.wEnv = Math.max(Math.abs(wl), this.wEnv * 0.9995);

      // ---- filters ----
      let L = wl * 2.5, R = wr * 2.5; // make-up gain after Wingie's post gain
      if (ctl) {
        const hpHz = clamp(20 * Math.pow(1000, clamp(sm['f.hp'] + dst[D['f.hp']], 0, 1)), 15, fmax);
        const lpHz = clamp(20 * Math.pow(1000, clamp(sm['f.lp'] + dst[D['f.lp']], 0, 1)), 15, fmax);
        const gH = Math.tan(Math.PI * hpHz / sr);
        const kH = 2 - 1.9 * sm['f.hpRes'];
        this.hpL.set(gH, kH); this.hpR.set(gH, kH);
        const gL = Math.tan(Math.PI * lpHz / sr);
        const res = sm['f.lpRes'];
        if (slope24) {
          const k2 = 2 - 1.96 * res;
          this.lpL1.set(gL, 1.414); this.lpR1.set(gL, 1.414);
          this.lpL2.set(gL, k2); this.lpR2.set(gL, k2);
        } else {
          const k1 = 2 - 1.96 * res;
          this.lpL1.set(gL, k1); this.lpR1.set(gL, k1);
        }
      }
      L = this.hpL.hp(L); R = this.hpR.hp(R);
      if (slope24) {
        L = this.lpL2.lp(fastTanh(this.lpL1.lp(L) * 0.8) * 1.25);
        R = this.lpR2.lp(fastTanh(this.lpR1.lp(R) * 0.8) * 1.25);
      } else {
        L = this.lpL1.lp(L); R = this.lpR1.lp(R);
      }

      // ---- color (post wave shaper) ----
      const ca = sm['x.amt'];
      if (ca > 0.001) {
        const g = 1 + ca * 14;
        let yL, yR;
        switch (colorType) {
          case 1: // tube: asymmetric
            yL = tube(L, g); yR = tube(R, g);
            break;
          case 2: // fold
            yL = Math.sin(L * g * 1.3); yR = Math.sin(R * g * 1.3);
            break;
          case 3: // fuzz: rectify + hard clip
            yL = fuzz(L, g); yR = fuzz(R, g);
            break;
          default: // tape
            yL = fastTanh(L * g) / Math.sqrt(g) * 1.6; yR = fastTanh(R * g) / Math.sqrt(g) * 1.6;
        }
        // remove DC from asymmetric shapes
        const dl = this.colorDcL, drr = this.colorDcR;
        const zl = yL - dl[0] + w.dcR * dl[1]; dl[0] = yL; dl[1] = zl;
        const zr = yR - drr[0] + w.dcR * drr[1]; drr[0] = yR; drr[1] = zr;
        L = L + (zl - L) * Math.min(1, ca * 3);
        R = R + (zr - R) * Math.min(1, ca * 3);
      }

      // ---- tape echo ----
      let targetD;
      if (syncTicks > 0) targetD = (syncTicks / Math.max(0.05, clk.hz)) * sr;
      else targetD = 0.02 * Math.pow(100, P['d.time']) * sr;
      targetD = clamp(targetD, 16, ec.size - 8);
      ec.time += (targetD - ec.time) * (1 / (0.25 * sr)) * 4; // tape glide
      ec.wow += TAU * 0.55 / sr; if (ec.wow > TAU) ec.wow -= TAU;
      ec.flut += TAU * 6.3 / sr; if (ec.flut > TAU) ec.flut -= TAU;
      const mod = wowDepth * (0.0035 * Math.sin(ec.wow) + 0.0006 * Math.sin(ec.flut)) * sr;
      const d0 = clamp(ec.time + mod, 4, ec.size - 4);
      const dL = ec.read(ec.bufL, d0);
      const dR = ec.read(ec.bufR, pingpong ? d0 : d0 * 1.007);
      const toneA = 1 - Math.exp(-TAU * (500 * Math.pow(30, sm['d.tone'])) / sr);
      ec.lpL += (dL - ec.lpL) * toneA; ec.lpR += (dR - ec.lpR) * toneA;
      const hpA = TAU * 70 / sr;
      ec.hpL += (ec.lpL - ec.hpL) * hpA; ec.hpR += (ec.lpR - ec.hpR) * hpA;
      const fbL = ec.lpL - ec.hpL, fbR = ec.lpR - ec.hpR;
      const fb = sm['d.fb'] * 1.05;
      let wL, wR;
      if (pingpong) { wL = (L + R) * 0.5 + fbR * fb; wR = fbL * fb; }
      else { wL = L + fbL * fb; wR = R + fbR * fb; }
      ec.bufL[ec.w] = fastTanh(wL);
      ec.bufR[ec.w] = fastTanh(wR);
      ec.w = (ec.w + 1) % ec.size;
      const em = sm['d.mix'];
      L += dL * em; R += dR * em;

      // ---- reverb (8-line FDN, Hadamard feedback) ----
      const rm = sm['r.mix'];
      if (rm > 0.0005) {
        const o = rv.o;
        for (let j = 0; j < 8; j++) {
          const buf = rv.buf[j];
          const len = rv.len[j];
          let r = rv.w[j] - len;
          const ml = buf.length;
          if (r < 0) r += ml;
          const i0 = Math.floor(r);
          const fr = r - i0;
          const a = buf[i0], b = buf[(i0 + 1) % ml];
          const v = a + (b - a) * fr;
          rv.lp[j] += (v - rv.lp[j]) * rv.dampA;
          o[j] = rv.lp[j] * rv.g[j];
        }
        // fast Walsh-Hadamard transform (8)
        for (let h = 1; h < 8; h <<= 1) {
          for (let j = 0; j < 8; j += h << 1) {
            for (let m = j; m < j + h; m++) { const x = o[m], y = o[m + h]; o[m] = x + y; o[m + h] = x - y; }
          }
        }
        const pre = rv.pre;
        const inp = pre[rv.preW];
        pre[rv.preW] = (L + R) * 0.5;
        rv.preW = (rv.preW + 1) % pre.length;
        let rl = 0, rr = 0;
        for (let j = 0; j < 8; j++) {
          const v = o[j] * 0.35355339 + inp * ((j & 1) ? -0.6 : 0.6);
          rv.buf[j][rv.w[j]] = v;
          rv.w[j] = (rv.w[j] + 1) % rv.buf[j].length;
          if (j & 1) rr += rv.lp[j]; else rl += rv.lp[j];
        }
        L += rl * 0.35 * rm; R += rr * 0.35 * rm;
      }

      // ---- master: gain, peak limiter, soft clip ----
      const mv = sm['m.vol'] * sm['m.vol'] * 1.6;
      L *= mv; R *= mv;
      const pk = Math.max(Math.abs(L), Math.abs(R));
      this.limEnv = pk > this.limEnv ? pk : this.limEnv * 0.99985;
      if (this.limEnv > 0.85) { const gr = 0.85 / this.limEnv; L *= gr; R *= gr; }
      L = fastTanh(L * 1.05) * 0.97;
      R = fastTanh(R * 1.05) * 0.97;
      if (!Number.isFinite(L) || !Number.isFinite(R)) { L = 0; R = 0; this.panicAll(); }
      oL[i] = L;
      if (oR !== oL) oR[i] = R;
      if (Math.abs(L) > this.peakL) this.peakL = Math.abs(L);
      if (Math.abs(R) > this.peakR) this.peakR = Math.abs(R);

      if (this.recording && this.recBuf) {
        this.recBuf[this.recPos++] = L;
        this.recBuf[this.recPos++] = R;
        if (this.recPos >= this.recBuf.length) { this.flushRec(); this.recBuf = new Float32Array(8192); }
      }

      // ---- update patch sources for the next sample ----
      src[S['k.out']] = k.out;
      src[S['k.noise']] = k.noise;
      src[S['k.env']] = k.dv / 255;
      src[S['c.clk']] = sq;
      src[S['c.tri']] = clk.tri;
      src[S['c.step']] = clk.step;
      // 50% square dividers: the Kastle TRIG fires on both edges, so ÷N into
      // TRIG gives evenly spaced hits every N/2 clock ticks.
      const ph = running ? clk.phase : 0;
      src[S['u.div2']] = ((dc % 2) + ph) < 1 ? 1 : 0;
      src[S['u.div3']] = ((dc % 3) + ph) < 1.5 ? 1 : 0;
      src[S['u.div4']] = ((dc % 4) + ph) < 2 ? 1 : 0;
      src[S['u.div8']] = ((dc % 8) + ph) < 4 ? 1 : 0;
      src[S['u.drift']] = driftV;
      src[S['w.trigL']] = w.L.trig ? 1 : 0;
      src[S['w.trigR']] = w.R.trig ? 1 : 0;
      src[S['w.env']] = Math.min(1, this.wEnv * 3);
    }

    this.t += n;
    this.meterAcc += n;
    if (this.meterAcc >= this.meterEvery) {
      this.meterAcc = 0;
      const e = [];
      for (const side of w.sides) for (let i = 0; i < N_RES; i++) e.push(Math.sqrt(side.energy[i]));
      this.port.postMessage({
        type: 'meter',
        clk: clk.sq, tri: clk.tri, step: clk.step, pos: clk.pos, hz: clk.hz,
        env: k.dv / 255, env2: k.dv2 / 255, drum: k.mode, trigState: k.trigState,
        analog: Array.from(k.analog),
        div: this.divCount,
        trigL: w.L.trig, trigR: w.R.trig, folL: w.L.fol, folR: w.R.fol,
        seqIdx: [w.L.seqIdx, w.R.seqIdx], notes: [w.L.note, w.R.note],
        freqs: [Array.from(w.L.freq), Array.from(w.R.freq)],
        energy: e,
        peak: [this.peakL, this.peakR],
        limit: this.limEnv > 0.85,
        drift: src[S['u.drift']],
      });
      this.peakL = 0; this.peakR = 0;
    }
  }

  panicAll() {
    this.wingie.panic(); this.echo.clear(); this.verb.clear();
    for (const f of [this.hpL, this.hpR, this.lpL1, this.lpL2, this.lpR1, this.lpR2]) f.reset();
  }
}

registerProcessor('harmonic-pulse', HarmonicPulseProcessor);
