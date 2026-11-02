import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProcessor, stats, dominantHz } from './harness.mjs';

const SR = 48000;
const make = await loadProcessor(SR);

test('all 8 drum styles render finite, bounded audio', () => {
  for (let style = 0; style < 8; style++) {
    for (const decay of [0.1, 0.392, 0.7, 1]) { // 0.392*255 = 100: envelope hold
      const p = make();
      p.send({ type: 'cables', cables: [['c.clk', 'k.trig'], ['c.step', 'k.pitch']] });
      p.send({ type: 'params', values: { 'k.drum': (style + 0.5) / 8, 'k.decay': decay, 'amt.k.trig': 1, 'c.rate': 0.6 } });
      const { L, R } = p.renderSeconds(1.5);
      const s = stats(L), r = stats(R);
      assert.equal(s.nan + r.nan, 0, `NaN in style ${style}`);
      assert.ok(s.peak <= 1 && r.peak <= 1, `clipping in style ${style}`);
      assert.equal(p.kastle.mode, style, 'DRUM knob selects the style');
      assert.equal(p.port.posted.filter((m) => m.type === 'error').length, 0);
    }
  }
});

test('TRIG is a 3-level input: square hits hard, triangle gives 4 accented hits per cycle', () => {
  const count = (cable, amt) => {
    const p = make();
    const hits = [];
    const orig = p.kastle.trigger.bind(p.kastle);
    p.kastle.trigger = (a, b) => { hits.push(Math.abs(a - b)); orig(a, b); };
    p.send({ type: 'cables', cables: [[cable, 'k.trig']] });
    p.send({ type: 'params', values: { 'amt.k.trig': amt, 'c.lock': 1, 'c.bpm': 60 } }); // 4 Hz clock
    p.renderSeconds(2.02);
    return hits;
  };
  const sq = count('c.clk', 1);
  assert.ok(sq.length >= 15 && sq.length <= 17, `square: ${sq.length} transitions`);
  assert.ok(sq.every((d) => d === 2), 'full-swing square = full-strength hits');
  const tri = count('c.tri', 1);
  assert.ok(tri.length >= 30 && tri.length <= 34, `triangle: ${tri.length} transitions`);
  assert.ok(tri.every((d) => d === 1), 'triangle steps through the middle state = accent hits');
  const weak = count('c.clk', 0.6); // 0..153 only reaches the middle state
  assert.ok(weak.length >= 15 && weak.every((d) => d === 1));
});

test('Kastle hits advance the Wingie String sequence once per hit', () => {
  const p = make();
  p.send({ type: 'cables', cables: [['u.div2', 'k.trig']] });
  p.send({ type: 'params', values: { 'amt.k.trig': 1, 'c.lock': 1, 'c.bpm': 120, 'k.decay': 0.7, 'k.range': 2 } });
  p.send({ type: 'wingie', state: { mode: [1, 1], seq: [[0, 3, 7], [0, 5]] }, resetSeq: [true, true] });
  p.renderSeconds(6);
  const hits = 6 * 8; // ÷2 square into TRIG = one hit per tick (8 ticks/s at 120 BPM)
  for (const ch of [0, 1]) {
    const n = p.wingie.advanceCount[ch];
    assert.ok(Math.abs(n - hits) <= 2, `ch${ch}: ${n} advances for ~${hits} hits`);
  }
});

test('W.ADV input advances the sequence even with the threshold off', () => {
  const p = make();
  p.send({ type: 'cables', cables: [['u.div4', 'w.adv']] });
  p.send({ type: 'params', values: { 'c.lock': 1, 'c.bpm': 120, 'w.threshL': 1, 'w.threshR': 1 } });
  p.send({ type: 'wingie', state: { mode: [1, 2], seq: [[0, 2], [0, 7, 5]] }, resetSeq: [true, true] });
  p.renderSeconds(4);
  assert.ok(Math.abs(p.wingie.advanceCount[0] - 8) <= 1, `got ${p.wingie.advanceCount[0]}`);
});

test('String mode resonates at the harmonics of the sequenced note', () => {
  const p = make();
  // one short hit, then listen to the free ring-out (the Kastle has decayed by then)
  p.send({ type: 'params', values: {
    'w.mix': 1, 'w.decay': 0.8, 'k.decay': 0.55, 'k.range': 1, 'c.run': 0,
    'f.lp': 1, 'f.hp': 0, 'd.mix': 0, 'r.mix': 0, 'x.amt': 0, 's.drive': 0, 'k.drum': 0.5, // TAH style
  } });
  p.send({ type: 'wingie', state: { mode: [1, 1], seq: [[9], [9]], oct: [0, -1] }, resetSeq: [true, true] });
  p.renderSeconds(0.2);
  p.send({ type: 'hit' });
  const { L } = p.renderSeconds(2);
  const f0 = 440 * Math.pow(2, (57 - 69) / 12); // A3 = 220 Hz
  const f = dominantHz(L, SR, SR * 1, 16384, 100, 2500);
  const h = f / f0;
  assert.ok(Math.abs(h - Math.round(h)) < 0.03, `dominant ${f.toFixed(1)} Hz is not a harmonic of ${f0} Hz`);
});

test('anti-feedback guard keeps a held, hot resonator bounded', () => {
  const p = make();
  p.send({ type: 'cables', cables: [['c.clk', 'k.trig']] });
  p.send({ type: 'params', values: { 'w.hold': 1, 'w.vol': 1, 'w.pre': 1, 'w.post': 1, 'k.outLvl': 1, 'k.noiseLvl': 1, 's.drive': 1, 'm.vol': 1, 'c.rate': 0.9, 'amt.k.trig': 1 } });
  p.send({ type: 'wingie', state: { mode: [3, 0] } });
  const { L, R } = p.renderSeconds(4);
  // The Faust guard acts once per 32-sample block, so a hot block can overshoot
  // before it clamps; what matters is that held energy never runs away.
  for (let i = 0; i < 9; i++) assert.ok(p.wingie.L.energy[i] < 100, `mode ${i} energy ${p.wingie.L.energy[i]}`);
  const s = stats(L), r = stats(R);
  assert.ok(s.peak <= 1 && r.peak <= 1 && s.nan === 0 && r.nan === 0);
});

test('quantised Kastle pitch lands on scale notes', () => {
  const p = make();
  p.send({ type: 'params', values: { 'k.qnt': 1, 'k.pitch': 0.37, 'k.drum': 0.3, 'g.root': 9, 'g.scale': 0 } });
  p.renderSeconds(0.1);
  const midi = 69 + 12 * Math.log2(p.kastle.qntHz / 440);
  assert.ok(Math.abs(midi - Math.round(midi)) < 1e-6);
  const pc = ((Math.round(midi) - 9) % 12 + 12) % 12;
  assert.ok([0, 3, 5, 7, 10].includes(pc), `pitch class ${pc} not in A minor pentatonic`);
});

test('bad messages are ignored', () => {
  const p = make();
  p.send(null);
  p.send({ type: 'params', values: { 'k.drum': NaN, nope: 1, 'm.vol': 'loud' } });
  p.send({ type: 'cables', cables: [['nope', 'k.trig'], ['c.clk', 'nowhere']] });
  const { L } = p.renderSeconds(0.2);
  assert.equal(stats(L).nan, 0);
  assert.equal(p.cables.length, 0);
});
