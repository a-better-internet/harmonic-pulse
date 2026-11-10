import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProcessor } from './harness.mjs';
import { encodeWav } from '../src/wav.js';
import { PRESETS } from '../src/presets.js';

const SR = 48000;
const make = await loadProcessor(SR);

function readWav(buf) {
  const v = new DataView(buf);
  const tag = (o) => String.fromCharCode(...new Uint8Array(buf, o, 4));
  assert.equal(tag(0), 'RIFF'); assert.equal(tag(8), 'WAVE');
  assert.equal(v.getUint32(4, true), buf.byteLength - 8, 'RIFF size');
  const fmt = { format: v.getUint16(20, true), channels: v.getUint16(22, true), rate: v.getUint32(24, true),
    byteRate: v.getUint32(28, true), align: v.getUint16(32, true), bits: v.getUint16(34, true) };
  let o = 12;
  let data = null;
  while (o < buf.byteLength) {
    const id = tag(o), size = v.getUint32(o + 4, true);
    if (id === 'data') { data = { offset: o + 8, size }; break; }
    o += 8 + size + (size & 1);
  }
  assert.ok(data, 'has a data chunk');
  assert.equal(data.offset + data.size, buf.byteLength);
  const n = data.size / (fmt.bits / 8);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = data.offset + i * (fmt.bits / 8);
    if (fmt.format === 3) out[i] = v.getFloat32(p, true);
    else if (fmt.bits === 24) { let x = v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getUint8(p + 2) << 16); if (x & 0x800000) x -= 0x1000000; out[i] = x; }
    else out[i] = v.getInt16(p, true);
  }
  return { fmt, samples: out };
}

test('24-bit WAV: correct header and exact sample values', () => {
  const src = new Float32Array([0, 0, 0.5, -0.5, 0.25, -1, 1, 0.999999]);
  const { buffer, frames, clipped } = encodeWav([src], 48000, { bits: 24, dither: false });
  const { fmt, samples } = readWav(buffer);
  assert.deepEqual(fmt, { format: 1, channels: 2, rate: 48000, byteRate: 48000 * 6, align: 6, bits: 24 });
  assert.equal(frames, 4);
  const max = 8388607;
  assert.deepEqual(Array.from(samples), [0, 0, Math.round(0.5 * max), Math.round(-0.5 * max), Math.round(0.25 * max), -max, max, Math.round(Math.fround(0.999999) * max)]);
  assert.equal(clipped, 0, 'full scale is not clipping');
});

test('24-bit dither stays within one LSB and never wraps', () => {
  const src = new Float32Array(20000);
  for (let i = 0; i < src.length; i++) src[i] = Math.sin(i * 0.01) * 0.999;
  const { buffer } = encodeWav([src], 44100, { bits: 24 });
  const { samples } = readWav(buffer);
  for (let i = 0; i < src.length; i++) assert.ok(Math.abs(samples[i] - src[i] * 8388607) <= 1.5, `sample ${i}`);
});

test('over-range input is clamped and reported, NaN becomes silence', () => {
  const { buffer, clipped } = encodeWav([new Float32Array([1.5, -2, NaN, 0])], 48000, { bits: 24, dither: false });
  assert.deepEqual(Array.from(readWav(buffer).samples), [8388607, -8388608, 0, 0]);
  assert.equal(clipped, 2);
});

test('32-bit float WAV keeps samples bit-exact; 16-bit still works', () => {
  const src = new Float32Array([0.1, -0.2, 0.3, -0.4]);
  const f = readWav(encodeWav([src], 48000, { bits: 32 }).buffer);
  assert.equal(f.fmt.format, 3); assert.equal(f.fmt.bits, 32);
  assert.deepEqual(Array.from(f.samples), Array.from(src));
  const h = readWav(encodeWav([src], 48000, { bits: 16, dither: false }).buffer);
  assert.equal(h.fmt.bits, 16); assert.equal(h.samples[0], Math.round(0.1 * 32767));
});

test('the recorder captures every output sample, in order, with a closing handshake', () => {
  const p = make();
  const pr = PRESETS.find((x) => x.name === 'Motorik');
  p.send({ type: 'params', values: pr.params }); p.send({ type: 'cables', cables: pr.cables });
  p.send({ type: 'wingie', state: pr.wingie, resetSeq: [true, true] });
  p.renderSeconds(0.5);
  p.port.posted.length = 0;
  p.send({ type: 'rec', on: true, id: 7 });
  const { L, R } = p.renderSeconds(2.37); // not a multiple of the 4096-frame chunk
  p.send({ type: 'rec', on: false });
  p.renderSeconds(0.1); // output after Stop must not leak into the take
  const chunks = p.port.posted.filter((m) => m.type === 'rec');
  const done = p.port.posted.filter((m) => m.type === 'recDone');
  assert.equal(done.length, 1);
  assert.equal(done[0].id, 7);
  assert.deepEqual(chunks.map((c) => c.seq), chunks.map((_, i) => i), 'chunks are contiguous');
  assert.equal(done[0].chunks, chunks.length);
  const total = chunks.reduce((a, c) => a + c.data.length, 0) / 2;
  assert.equal(total, L.length, 'every rendered frame was captured');
  assert.equal(done[0].frames, L.length);
  let j = 0;
  for (const c of chunks) for (let i = 0; i < c.data.length; i += 2, j++) {
    if (c.data[i] !== L[j] || c.data[i + 1] !== R[j]) assert.fail(`frame ${j} differs from the output`);
  }
  const wav = encodeWav(chunks.map((c) => c.data), SR, { bits: 24 });
  assert.equal(wav.frames, L.length);
  assert.equal(wav.clipped, 0);
  assert.ok(wav.peak < 1 && Math.abs(wav.peak - done[0].peak) < 1e-6, `peak ${wav.peak} vs ${done[0].peak}`);
});

test('no preset clips the recording, even with master and drive at maximum', () => {
  for (const pr of PRESETS) {
    const p = make();
    p.send({ type: 'params', values: { ...pr.params, 'm.vol': 1, 's.drive': 1, 'w.vol': 1, 'w.post': 1, 'x.amt': 0.7, 'd.fb': 1 } });
    p.send({ type: 'cables', cables: pr.cables });
    p.send({ type: 'wingie', state: pr.wingie, resetSeq: [true, true] });
    p.send({ type: 'rec', on: true, id: 1 });
    p.renderSeconds(3);
    p.send({ type: 'rec', on: false });
    const done = p.port.posted.find((m) => m.type === 'recDone');
    assert.ok(done.peak < 0.99, `${pr.name}: peak ${done.peak}`);
    const wav = encodeWav(p.port.posted.filter((m) => m.type === 'rec').map((m) => m.data), SR, { bits: 24 });
    assert.equal(wav.clipped, 0, pr.name);
  }
});
