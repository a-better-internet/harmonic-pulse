// UI-side parameter definitions. Every id here must exist in the worklet's
// DEFAULT_PARAMS (test/ui-defs.test.mjs checks this).

export const DRUM_STYLES = ['FM', 'NOISE', 'T&H', 'KICK', 'SNARE', 'CLAP', 'HAT', 'PWM CLAP'];
export const STEP_MODES = ['RND', '8', '16'];
export const SYNC_LABELS = ['free', '1 tick', '2 ticks', '3 ticks', '4 ticks', '6 ticks', '8 ticks', '12 ticks', '16 ticks'];
export const COLOR_TYPES = ['Tape', 'Tube', 'Fold', 'Fuzz'];
// X/Y pad targets: each axis sweeps one knob between lo and hi.
export const PAD_TARGETS = [
  { id: '', label: 'None' },
  { id: 'f.lp', label: 'Filter cutoff', lo: 0.25, hi: 0.95 },
  { id: 'f.lpRes', label: 'Filter resonance', lo: 0, hi: 0.85 },
  { id: 'f.env', label: 'Filter env', lo: 0, hi: 0.9 },
  { id: 'w.decay', label: 'Wingie decay', lo: 0.15, hi: 0.95 },
  { id: 'w.mix', label: 'Wingie mix', lo: 0.3, hi: 1 },
  { id: 'w.damp', label: 'Wingie damp', lo: 0, hi: 1 },
  { id: 'w.stretch', label: 'Wingie stretch', lo: -0.8, hi: 0.8 },
  { id: 'w.spread', label: 'Wingie spread', lo: 0, hi: 1 },
  { id: 'k.wave', label: 'Kastle wave', lo: 0, hi: 1 },
  { id: 'k.pitch', label: 'Kastle pitch', lo: 0.15, hi: 0.85 },
  { id: 'k.decay', label: 'Kastle decay', lo: 0.45, hi: 0.9 },
  { id: 'k.drum', label: 'Kastle drum style', lo: 0, hi: 1 },
  { id: 'o.wave', label: 'Voice wave', lo: 0, hi: 1 },
  { id: 'o.pw', label: 'Voice width', lo: 0.1, hi: 0.9 },
  { id: 'o.lvlD', label: 'Voice level', lo: 0, hi: 0.9 },
  { id: 's.drive', label: 'Drive', lo: 0, hi: 0.8 },
  { id: 's.fold', label: 'Fold', lo: 0, hi: 0.8 },
  { id: 'x.amt', label: 'Colour', lo: 0, hi: 0.7 },
  { id: 'd.fb', label: 'Echo repeats', lo: 0, hi: 0.95 },
  { id: 'd.mix', label: 'Echo mix', lo: 0, hi: 0.6 },
  { id: 'r.mix', label: 'Reverb', lo: 0, hi: 0.7 },
];
export const LFO_SHAPES = ['Sine', 'Tri', 'Up', 'Down', 'Sqr', 'S&H', 'Rnd'];
export const LFO_SYNC = ['Free (Rate knob)', '1 tick', '2 ticks', '4 ticks (1 beat)', '8 ticks', '16 ticks (1 bar)', '32 ticks', '64 ticks'];
export const VOICE_SOURCES = ['Wingie L note', 'Wingie R note', 'Step (quantised)', 'Key root'];
export const VOICE_TRIGS = ['Hits', 'Gate in', 'Drone'];
const KWAVES = ['Sine', 'Tri', 'Saw', 'Square', 'Cheb3', 'Cheb4', 'Cheb5', 'Cheb6'];
const VWAVES = ['Sine', 'Tri', 'Saw', 'Pulse'];
function morphName(names) {
  return (v) => {
    const x = v * (names.length - 1);
    const i = Math.min(names.length - 2, Math.floor(x));
    const f = x - i;
    if (f < 0.04) return names[i];
    if (f > 0.96) return names[i + 1];
    return `${names[i]}›${names[i + 1]}`;
  };
}
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
  // Round 2: dial-in
  'k.wave': { label: 'Wave', def: 0, fmt: morphName(KWAVES), title: 'Morphs the firmware wavetable: sine, triangle, saw, square (writeWave) and the Chebyshev tables. Shapes FM, NOISE, T&H and the NOISES glitch.' },
  'k.kit': { label: 'Kit', def: 0, min: 0, max: 7, step: 1 },
  'o.lvlW': { label: 'To Wingie', def: 0, fmt: pct },
  'o.lvlD': { label: 'Direct', def: 0, fmt: pct },
  'o.wave': { label: 'Wave', def: 0.667, fmt: morphName(VWAVES) },
  'o.pw': { label: 'Width', def: 0.5, min: 0.05, max: 0.95, fmt: pct },
  'o.sub': { label: 'Sub', def: 0, fmt: pct },
  'o.det': { label: 'Unison', def: 0, fmt: (v) => (v < 0.01 ? 'off' : `+${Math.round(v * 25)}¢`) },
  'o.oct': { label: 'Octave', def: 0, min: -2, max: 2, step: 1, fmt: (v) => (v > 0 ? `+${v}` : String(v)) },
  'o.fine': { label: 'Fine', def: 0, min: -50, max: 50, step: 1, bipolar: true, fmt: (v) => `${v > 0 ? '+' : ''}${Math.round(v)}¢` },
  'o.glide': { label: 'Glide', def: 0, fmt: (v) => (v < 0.01 ? 'off' : `${Math.round((0.002 + v * v * 0.8) * 1000)}ms`) },
  'o.att': { label: 'Attack', def: 0.05, fmt: (v) => `${Math.round(Math.pow(1000, v))}ms` },
  'o.dec': { label: 'Decay', def: 0.45, fmt: (v) => { const t = 0.02 * Math.pow(200, v); return t < 1 ? `${Math.round(t * 1000)}ms` : `${t.toFixed(1)}s`; } },
  'o.src': { label: 'Pitch from', def: 0, min: 0, max: 3, step: 1 },
  'o.trig': { label: 'Trigger', def: 0, min: 0, max: 2, step: 1 },
  'l.rate': { label: 'Rate', def: 0.4, fmt: (v) => `${(0.02 * Math.pow(1000, v)).toFixed(2)}Hz` },
  'l.shape': { label: 'Shape', def: 0, min: 0, max: 6, step: 1 },
  'l.sync': { label: 'Sync', def: 0, min: 0, max: 7, step: 1 },
  'f.env': { label: 'Env amt', def: 0, min: -1, max: 1, bipolar: true, fmt: (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`, title: 'How far each Kastle hit opens (or closes) the filter' },
  'f.envDec': { label: 'Env decay', def: 0.4, fmt: (v) => { const t = 0.01 * Math.pow(200, v); return t < 1 ? `${Math.round(t * 1000)}ms` : `${t.toFixed(1)}s`; } },
  'f.bp': { label: 'Band-pass', def: 0, toggle: true },
  'w.damp': { label: 'Damp', def: 0, fmt: pct, title: 'Higher partials die sooner: 0 is the Wingie, up is wood and felt' },
  'w.stretch': { label: 'Stretch', def: 0, min: -1, max: 1, bipolar: true, fmt: (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`, title: 'Bends the partial ratios: up is bell and metal, down is squeezed and gamelan-like' },
  'w.spread': { label: 'Spread', def: 0, fmt: (v) => `${Math.round(v * 40)}¢`, title: 'Detunes left down and right up for stereo width' },
  // Round 3: performance pad
  'p.x': { label: 'X', def: 0.5, fmt: (v) => v.toFixed(2) },
  'p.y': { label: 'Y', def: 0.5, fmt: (v) => v.toFixed(2) },
  'p.gate': { label: 'Gate', def: 0 },
  'p.xT': { label: 'X target', def: 1, min: 0, max: 21, step: 1 },
  'p.yT': { label: 'Y target', def: 4, min: 0, max: 21, step: 1 },
  'p.latch': { label: 'Latch', def: 1, toggle: true },
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
