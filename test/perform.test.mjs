import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProcessor, stats } from './harness.mjs';

const SR = 48000;
const make = await loadProcessor(SR);

function each(p, seconds, fn) {
  const blocks = Math.ceil((seconds * SR) / 128);
  for (let b = 0; b < blocks; b++) {
    const oL = new Float32Array(128), oR = new Float32Array(128);
    p.process([], [[oL, oR]]);
    fn(oL, oR);
  }
}

function pulse(p, extra = {}) {
  p.send({ type: 'cables', cables: [['u.div4', 'k.trig']] });
  p.send({ type: 'params', values: { 'c.lock': 1, 'c.bpm': 120, 'k.decay': 0.6, 'k.range': 1, ...extra } });
}

test('a rest step mutes the resonator drive and holds the previous pitch', () => {
  const p = make();
  pulse(p);
  p.send({ type: 'wingie', state: { mode: [1, 1], oct: [0, 0], seq: [[0, 7], [0]], acc: [[0, 3], [0]] }, resetSeq: [true, true] });
  const f0 = 440 * Math.pow(2, (48 - 69) / 12);
  let restSeen = 0;
  each(p, 3, () => {
    const L = p.wingie.L;
    if (L.seqIdx === 1 && p.wingie.blockCount > 4) {
      restSeen++;
      assert.ok(Math.abs(L.freq[0] - f0) < 1e-6, `rest retuned to ${L.freq[0]}`);
      assert.equal(L.stepGainT, 0);
    }
  });
  assert.ok(restSeen > 20, 'the sequence reached the rest step');
  assert.ok(p.wingie.advanceCount[0] >= 10, 'rests still advance the sequence');
});

test('accented steps ring the resonator harder than ghost steps', () => {
  const wet = (acc) => {
    const p = make();
    pulse(p, { 'w.mix': 1, 'd.mix': 0, 'r.mix': 0, 'f.lp': 1, 'f.hp': 0, 'x.amt': 0 });
    p.send({ type: 'wingie', state: { mode: [1, 1], oct: [0, 0], seq: [[0, 3, 7, 10], [0, 3, 7, 10]], acc: [[acc, acc, acc, acc], [acc, acc, acc, acc]] }, resetSeq: [true, true] });
    p.renderSeconds(0.5);
    return stats(p.renderSeconds(3).L).rms;
  };
  const accent = wet(1), normal = wet(0), ghost = wet(2);
  assert.ok(accent > normal * 1.2 && normal > ghost * 1.5, `accent ${accent} normal ${normal} ghost ${ghost}`);
});

test('the voice is struck at the accent level of the step it follows', () => {
  const p = make();
  pulse(p, { 'o.lvlD': 0.5, 'o.src': 0, 'o.trig': 0, 'o.att': 0 });
  p.send({ type: 'wingie', state: { mode: [1, 1], oct: [0, 0], seq: [[0, 5, 7], [0]], acc: [[1, 2, 3], [0]] }, resetSeq: [true, true] });
  const velByStep = new Map();
  each(p, 4, () => {
    const idx = p.wingie.L.seqIdx;
    const age = p.t - p.lastHitT;
    if (age > 0.06 * SR && age < 0.1 * SR) velByStep.set(idx, p.voice.vel);
  });
  assert.ok(Math.abs(velByStep.get(0) - 1.35) < 1e-9, `accent vel ${velByStep.get(0)}`);
  assert.ok(Math.abs(velByStep.get(1) - 0.45) < 1e-9, `ghost vel ${velByStep.get(1)}`);
  assert.equal(velByStep.get(2), 0, 'rest silences the voice');
});

test('Acc L jack reports the current step level', () => {
  const p = make();
  pulse(p);
  p.send({ type: 'wingie', state: { mode: [1, 1], seq: [[0, 2, 4, 5], [0]], acc: [[0, 1, 2, 3], [0]] }, resetSeq: [true, true] });
  const seen2 = new Set();
  each(p, 3, () => seen2.add(p.src[p.src.length - 4])); // w.accL precedes p.x, p.y, p.gate
  assert.deepEqual([...seen2].sort(), [0, 0.25, 0.5, 1]);
});

test('X/Y pad values reach the patch bay as sources', () => {
  const p = make();
  p.send({ type: 'cables', cables: [['p.x', 'f.lp'], ['p.y', 'w.decay'], ['p.gate', 'k.trig']] });
  p.send({ type: 'params', values: { 'p.x': 0.9, 'p.y': 0.2, 'p.gate': 1 } });
  p.renderSeconds(0.3);
  const n = p.src.length;
  assert.ok(Math.abs(p.src[n - 3] - 0.9) < 1e-3, `x ${p.src[n - 3]}`);
  assert.ok(Math.abs(p.src[n - 2] - 0.2) < 1e-3, `y ${p.src[n - 2]}`);
  assert.equal(p.src[n - 1], 1);
  assert.equal(p.kastle.trigState, 2, 'gate into TRIG reaches the high level');
});
