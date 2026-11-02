import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProcessor, stats, dominantHz } from './harness.mjs';
import { KITS } from '../src/kits.js';

const SR = 48000;
const make = await loadProcessor(SR);

function renderSamples(p, n, fn) {
  const blocks = Math.ceil(n / 128);
  for (let b = 0; b < blocks; b++) {
    const oL = new Float32Array(128), oR = new Float32Array(128);
    p.process([], [[oL, oR]]);
    if (fn) fn(oL, oR);
  }
}

test('Kastle WAVE morph lands exactly on the firmware tables', () => {
  const p = make();
  const k = p.kastle;
  k.setWave(1 / 7); // triangle (writeWave 1)
  assert.equal(k.wt[0], 0); assert.equal(k.wt[64], 128); assert.equal(k.wt[128], 255);
  k.setWave(2 / 7); // saw (writeWave 3)
  for (const i of [0, 77, 255]) assert.equal(k.wt[i], i);
  k.setWave(3 / 7); // square (writeWave 2)
  assert.equal(k.wt[10], 255); assert.equal(k.wt[200], 1);
  k.setWave(0); // sine
  assert.equal(k.wt[64], 128); assert.equal(k.wt[128], 255);
});

test('every kit x wave x drum style renders cleanly', () => {
  for (let kit = 0; kit < KITS.length; kit++) {
    for (const wave of [0, 0.3, 0.6, 1]) {
      for (const style of [0, 1, 2, 3, 4, 5, 6, 7]) {
        const p = make();
        p.send({ type: 'cables', cables: [['u.div2', 'k.trig']] });
        p.send({ type: 'params', values: { 'k.kit': kit, 'k.wave': wave, 'k.drum': (style + 0.5) / 8, 'k.decay': 0.3, 'c.lock': 1, 'c.bpm': 160 } });
        const { L } = p.renderSeconds(0.4);
        const s = stats(L);
        assert.equal(s.nan, 0, `kit ${kit} wave ${wave} style ${style}`);
        assert.ok(s.peak <= 1);
        assert.equal(p.kastle.kit, kit);
      }
    }
  }
});

test('voice follows the Wingie note and sounds at that pitch', () => {
  const p = make();
  p.send({ type: 'params', values: {
    'o.lvlD': 1, 'o.trig': 2, 'o.wave': 0, 'o.src': 0, 'o.oct': 0, 'k.outLvl': 0, 'k.noiseLvl': 0,
    'w.mix': 0, 'f.lp': 1, 'f.hp': 0, 'd.mix': 0, 'r.mix': 0, 'x.amt': 0, 'c.run': 0,
  } });
  p.send({ type: 'wingie', state: { mode: [1, 1], seq: [[9], [9]], oct: [0, 0] }, resetSeq: [true, true] });
  const { L } = p.renderSeconds(1);
  assert.ok(Math.abs(p.voiceHz - 220) < 0.01, `voice at ${p.voiceHz}`);
  const f = dominantHz(L, SR, SR / 2, 16384, 100, 1000);
  assert.ok(Math.abs(f - 220) < 3, `dominant ${f}`);
});

test('voice is struck by Kastle hits with an AD envelope', () => {
  const p = make();
  p.send({ type: 'cables', cables: [['u.div4', 'k.trig']] });
  p.send({ type: 'params', values: { 'o.lvlW': 0.5, 'o.dec': 0.1, 'o.wave': 1, 'c.lock': 1, 'c.bpm': 120 } });
  let maxEnv = 0, minEnv = 1;
  renderSamples(p, SR * 2, () => { maxEnv = Math.max(maxEnv, p.voice.env); minEnv = Math.min(minEnv, p.voice.env); });
  assert.ok(maxEnv > 0.55 && minEnv < 0.05, `env ${minEnv}..${maxEnv}`);
});

test('voice waveforms stay band-limited and bounded across the morph', () => {
  for (const wave of [0, 0.33, 0.5, 0.67, 0.85, 1]) {
    const p = make();
    p.send({ type: 'params', values: { 'o.lvlD': 1, 'o.trig': 2, 'o.wave': wave, 'o.sub': 0.5, 'o.det': 0.5, 'o.src': 3, 'o.oct': 2, 'k.outLvl': 0, 'k.noiseLvl': 0, 'w.mix': 0 } });
    const { L } = p.renderSeconds(0.5);
    const s = stats(L);
    assert.equal(s.nan, 0);
    assert.ok(s.peak <= 1 && s.rms > 0.01, `wave ${wave}: ${JSON.stringify(s)}`);
  }
});

test('LFO synced to 4 ticks completes one cycle every 4 clock ticks', () => {
  const p = make();
  p.send({ type: 'params', values: { 'l.sync': 3, 'l.shape': 2, 'c.lock': 1, 'c.bpm': 120 } }); // ramp, 8 ticks/s
  let wraps = 0, last = 0, lo = 1, hi = 0;
  renderSamples(p, SR * 4, () => {
    const v = p.lfo.out;
    if (v < last - 0.5) wraps++;
    last = v; lo = Math.min(lo, v); hi = Math.max(hi, v);
  });
  assert.ok(Math.abs(wraps - 8) <= 1, `wraps ${wraps}`); // 32 ticks / 4
  assert.ok(lo >= 0 && hi <= 1);
});

test('filter envelope opens on every hit and decays', () => {
  const p = make();
  p.send({ type: 'cables', cables: [['u.div8', 'k.trig']] });
  p.send({ type: 'params', values: { 'f.env': 1, 'f.envDec': 0.2, 'c.lock': 1, 'c.bpm': 120 } });
  let hi = 0, lo = 1;
  renderSamples(p, SR * 2, () => { hi = Math.max(hi, p.fenv); lo = Math.min(lo, p.fenv); });
  assert.ok(hi > 0.5 && lo < 0.05, `fenv ${lo}..${hi}`); // observed once per 128-sample block
});

test('Wingie damp, stretch and spread reshape the resonators', () => {
  const p = make();
  p.send({ type: 'params', values: { 'w.stretch': 1, 'w.spread': 1, 'w.damp': 1 } });
  p.send({ type: 'wingie', state: { mode: [1, 1], seq: [[0], [0]], oct: [0, -1] }, resetSeq: [true, true] });
  p.renderSeconds(0.05);
  const L = p.wingie.L, R = p.wingie.R;
  const ratio = L.freq[4] / L.freq[0];
  assert.ok(Math.abs(ratio - Math.pow(5, 1.25)) < 1e-6, `stretched ratio ${ratio}`);
  const cents = 1200 * Math.log2(R.freq[0] / L.freq[0]);
  assert.ok(Math.abs(cents - 40) < 0.01, `spread ${cents} cents`); // same note both sides here
  assert.ok(L.rho[8] < L.rho[0], 'high partial decays faster with damp');
});
