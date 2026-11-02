import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProcessor } from './harness.mjs';
import { PARAMS } from '../src/params.js';
import { INPUTS, OUTPUTS } from '../src/patch-def.js';
import { PRESETS } from '../src/presets.js';

const make = await loadProcessor(44100);
const p = make();

test('every UI parameter exists in the worklet', () => {
  for (const id of Object.keys(PARAMS)) assert.ok(id in p.P, `worklet is missing ${id}`);
  for (const id of Object.keys(INPUTS)) assert.ok(`amt.${id}` in p.P, `worklet is missing amt.${id}`);
});

test('every patch port is known to the worklet', () => {
  const all = Object.keys(OUTPUTS).flatMap((o) => Object.keys(INPUTS).map((i) => [o, i]));
  p.send({ type: 'cables', cables: all });
  assert.equal(p.cables.length, all.length);
});

test('presets only use known params and ports', () => {
  for (const pr of PRESETS) {
    for (const k of Object.keys(pr.params)) assert.ok(k in p.P, `${pr.name}: unknown param ${k}`);
    for (const [a, b] of pr.cables) assert.ok(a in OUTPUTS && b in INPUTS, `${pr.name}: bad cable ${a}->${b}`);
  }
});

test('every preset renders cleanly', () => {
  for (const pr of PRESETS) {
    const q = make();
    q.send({ type: 'params', values: pr.params });
    q.send({ type: 'cables', cables: pr.cables });
    q.send({ type: 'wingie', state: pr.wingie, resetSeq: [true, true] });
    const { L, R } = q.renderSeconds(3);
    let peak = 0, sum = 0;
    for (let i = 0; i < L.length; i++) {
      assert.ok(Number.isFinite(L[i]) && Number.isFinite(R[i]), `${pr.name}: non-finite sample`);
      peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
      sum += L[i] * L[i];
    }
    const rms = Math.sqrt(sum / L.length);
    assert.ok(peak <= 1, `${pr.name}: peak ${peak}`);
    assert.ok(rms > 0.005, `${pr.name} is near-silent (rms ${rms})`);
  }
});
