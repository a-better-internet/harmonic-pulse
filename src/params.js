// UI-side parameter definitions. Every id here must exist in the worklet's
// DEFAULT_PARAMS (test/ui-defs.test.mjs checks this).

export const DRUM_STYLES = ['FM', 'NOISE', 'T&H', 'KICK', 'SNARE', 'CLAP', 'HAT', 'PWM CLAP'];
export const STEP_MODES = ['RND', '8', '16'];
export const SYNC_LABELS = ['free', '1 tick', '2 ticks', '3 ticks', '4 ticks', '6 ticks', '8 ticks', '12 ticks', '16 ticks'];
export const COLOR_TYPES = ['Tape', 'Tube', 'Fold', 'Fuzz'];
export const WINGIE_MODES = [
  { name: 'Poly', led: '#f4f1ea' },
  { name: 'String', led: '#ffd23f' },
  { name: 'Bar', led: '#ff4b3e' },
  { name: 'Cave', led: '#b56cff' },
  { name: 'Ratio', led: 'linear-gradient(90deg,#f4f1ea 50%,#ffd23f 50%)' },
];

const pct = (v) => `${Math.round(v * 100)}%`;
const hzFmt = (hz) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 1 : 2)}k` : `${hz.toFixed(hz < 100 ? 1 : 0)}`);
const cutoff = (v) => `${hzFmt(20 * Math.pow(1000, v))}Hz`;
export const clockHz = (v) => 0.25 * Math.pow(128, v);
export const drumStyle = (v) => Math.min(7, Math.round(v * 255) >> 5);

export const PARAMS = {
  // Kastle Drum
  'k.drum': { label: 'Drum', def: 0.04, fmt: (v) => DRUM_STYLES[drumStyle(v)] },
  'k.pitch': { label: 'Pitch', def: 0.4, fmt: (v) => String(Math.round(v * 255)) },
  'k.decay': {
    label: 'Decay', def: 0.62,
    fmt: (v) => { const a = Math.round(v * 255); return a < 100 ? `pitch ${100 - a}` : a === 100 ? 'hold' : a <= 120 ? 'snap' : String(a - 120); },
  },
  'k.range': { label: 'Range', def: 2, min: 0.5, max: 8, fmt: (v) => `×${v.toFixed(1)}` },
  'k.outLvl': { label: 'Out', def: 0.85, fmt: pct },
  'k.noiseLvl': { label: 'Noises', def: 0.25, fmt: pct },
  'k.qnt': { label: 'Quantise', def: 0, toggle: true },
  'k.xy': { label: 'Env→Noises', def: 0, toggle: true },
  // Clock
  'c.rate': { label: 'Rate', def: 0.5, fmt: (v) => `${clockHz(v).toFixed(2)}Hz` },
  'c.bpm': { label: 'BPM', def: 120, min: 30, max: 300, step: 1, fmt: (v) => String(Math.round(v)) },
  'c.lock': { label: 'BPM lock', def: 0, toggle: true },
  'c.run': { label: 'Run', def: 1, toggle: true },
  'c.mode': { label: 'Step mode', def: 2, min: 0, max: 2, step: 1 },
  'c.glide': { label: 'Glide', def: 0, fmt: pct },
  'u.drift': { label: 'Drift', def: 0.3, fmt: (v) => `${(0.02 * Math.pow(150, v)).toFixed(2)}Hz` },
  // Shaper
  's.drive': { label: 'Drive', def: 0.1, fmt: pct },
  's.fold': { label: 'Fold', def: 0, fmt: pct },
  's.crush': { label: 'Bits', def: 0, fmt: (v) => (v < 0.001 ? 'off' : `${(16 - v * 13).toFixed(1)}b`) },
  's.down': { label: 'Rate÷', def: 0, fmt: (v) => `÷${1 + Math.floor(v * v * 47)}` },
  's.feed': { label: 'Split L/R', def: 0, toggle: true },
  // Wingie
  'w.mix': { label: 'Mix', def: 0.8, fmt: pct },
  'w.decay': { label: 'Decay', def: 0.5, fmt: (v) => `${(0.1 * Math.pow(100, v)).toFixed(v > 0.5 ? 1 : 2)}s` },
  'w.vol': { label: 'Volume', def: 0.7, fmt: pct },
  'w.threshL': { label: 'Thresh L', def: 0.1, fmt: (v) => (v >= 0.999 ? 'off' : v.toFixed(2)) },
  'w.threshR': { label: 'Thresh R', def: 0.1, fmt: (v) => (v >= 0.999 ? 'off' : v.toFixed(2)) },
  'w.pre': { label: 'Pre clip', def: 0.5, fmt: pct },
  'w.post': { label: 'Post clip', def: 0.5, fmt: pct },
  'w.tuning': { label: 'Tuning', def: -1, min: -1, max: 7, step: 1 },
  'w.a3': { label: 'A3', def: 440, min: 358.08, max: 521.91, step: 0.01, fmt: (v) => `${v.toFixed(1)}` },
  'w.guard': { label: 'Guard', def: 1, toggle: true },
  'w.hold': { label: 'Hold', def: 0, toggle: true },
  // Filters
  'f.hp': { label: 'HP', def: 0.1, fmt: cutoff },
  'f.hpRes': { label: 'HP res', def: 0.1, fmt: pct },
  'f.lp': { label: 'LP', def: 0.85, fmt: cutoff },
  'f.lpRes': { label: 'LP res', def: 0.2, fmt: pct },
  'f.slope': { label: '24 dB', def: 1, toggle: true },
  // Color
  'x.type': { label: 'Type', def: 0, min: 0, max: 3, step: 1 },
  'x.amt': { label: 'Amount', def: 0.15, fmt: pct },
  // Space
  'd.time': { label: 'Time', def: 0.5, fmt: (v) => `${Math.round(20 * Math.pow(100, v))}ms` },
  'd.sync': { label: 'Sync', def: 3, min: 0, max: 8, step: 1 },
  'd.fb': { label: 'Repeats', def: 0.4, fmt: pct },
  'd.tone': { label: 'Tone', def: 0.55, fmt: (v) => `${hzFmt(500 * Math.pow(30, v))}Hz` },
  'd.wow': { label: 'Wow', def: 0.25, fmt: pct },
  'd.mix': { label: 'Echo', def: 0.25, fmt: pct },
  'd.pp': { label: 'Ping-pong', def: 1, toggle: true },
  'r.size': { label: 'Size', def: 0.55, fmt: pct },
  'r.damp': { label: 'Damp', def: 0.45, fmt: pct },
  'r.mix': { label: 'Reverb', def: 0.2, fmt: pct },
  // Master / global
  'm.vol': { label: 'Master', def: 0.6, fmt: pct },
  'g.root': { label: 'Root', def: 9, min: 0, max: 11, step: 1 },
  'g.scale': { label: 'Scale', def: 0, min: 0, max: 11, step: 1 },
};

for (const p of Object.values(PARAMS)) {
  if (p.min === undefined) p.min = 0;
  if (p.max === undefined) p.max = p.toggle ? 1 : 1;
  if (!p.fmt) p.fmt = (v) => String(v);
}

export function defaultParams() {
  const out = {};
  for (const [id, p] of Object.entries(PARAMS)) out[id] = p.def;
  return out;
}
