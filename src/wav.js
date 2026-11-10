// WAV encoder for recordings. Input: interleaved stereo Float32Array chunks.
//   24-bit PCM (default): TPDF dither of ±1 LSB, then rounded and clamped.
//   16-bit PCM: same, at 16 bits.
//   32-bit float: the samples exactly as rendered (WAVE_FORMAT_IEEE_FLOAT).
// The master limiter keeps the output below full scale, so the clamp is a
// safety net, never a clipper: `clipped` reports how many samples needed it.

export const WAV_FORMATS = {
  24: { label: '24-bit WAV', bits: 24, float: false },
  16: { label: '16-bit WAV', bits: 16, float: false },
  32: { label: '32-bit float WAV', bits: 32, float: true },
};

export function encodeWav(chunks, sampleRate, { bits = 24, channels = 2, dither = true, random = Math.random } = {}) {
  const fmt = WAV_FORMATS[bits];
  if (!fmt) throw new Error(`Unsupported bit depth: ${bits}`);
  let total = 0;
  for (const c of chunks) total += c.length;
  const frames = Math.floor(total / channels);
  const samples = frames * channels;
  const bytesPer = bits / 8;
  const dataBytes = samples * bytesPer;
  const headerBytes = fmt.float ? 58 : 44; // float adds cbSize + a fact chunk
  const buf = new ArrayBuffer(headerBytes + dataBytes);
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };

  str(0, 'RIFF'); v.setUint32(4, headerBytes - 8 + dataBytes, true); str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, fmt.float ? 18 : 16, true);
  v.setUint16(20, fmt.float ? 3 : 1, true); // 3 = IEEE float, 1 = PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * bytesPer, true);
  v.setUint16(32, channels * bytesPer, true);
  v.setUint16(34, bits, true);
  let o = 36;
  if (fmt.float) {
    v.setUint16(36, 0, true); // cbSize
    str(38, 'fact'); v.setUint32(42, 4, true); v.setUint32(46, frames, true);
    o = 50;
  }
  str(o, 'data'); v.setUint32(o + 4, dataBytes, true);
  o += 8;

  const max = fmt.float ? 1 : Math.pow(2, bits - 1) - 1; // 8388607 for 24-bit
  const min = -max - 1;
  let peak = 0, clipped = 0, n = 0;
  for (const c of chunks) {
    for (let i = 0; i < c.length && n < samples; i++, n++) {
      let x = c[i];
      if (!Number.isFinite(x)) x = 0;
      const a = Math.abs(x);
      if (a > peak) peak = a;
      if (fmt.float) {
        v.setFloat32(o, x, true);
        o += 4;
        continue;
      }
      let q = x * max + (dither ? random() - random() : 0); // TPDF, ±1 LSB
      q = Math.round(q);
      if (q > max) { q = max; if (a >= 1) clipped++; }
      else if (q < min) { q = min; if (a >= 1) clipped++; }
      if (bits === 24) {
        u8[o] = q & 0xff; u8[o + 1] = (q >> 8) & 0xff; u8[o + 2] = (q >> 16) & 0xff;
        o += 3;
      } else {
        v.setInt16(o, q, true);
        o += 2;
      }
    }
  }
  return { buffer: buf, frames, peak, clipped, seconds: frames / sampleRate };
}

export function dbfs(x) { return x > 0 ? 20 * Math.log10(x) : -Infinity; }
