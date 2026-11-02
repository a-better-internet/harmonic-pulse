// Factory patches. Each preset only lists what differs from the defaults.
// Wingie modes: 0 Poly, 1 String, 2 Bar, 3 Cave, 4 Ratio.
// String/Bar sequence entries are semitones above C of the channel's octave.

export function defaultWingie() {
  return {
    mode: [1, 2],
    oct: [0, -1],
    poly: [[57, 60, 64], [69, 72, 76]],
    polyNext: [0, 0],
    ratioNotes: [[57, 60, 64], [69, 72, 76]],
    ratioNext: [0, 0],
    seq: [[9], [9]],
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
}

export const PRESETS = [
  {
    name: 'Motorik',
    note: 'Steady 16th-note Kastle FM pulse. Every hit walks the left string through an A-minor riff while the stepped generator nudges the right bar.',
    params: {
      'c.lock': 1, 'c.bpm': 124, 'c.mode': 2,
      'k.drum': 0.04, 'k.pitch': 0.33, 'k.decay': 0.66, 'k.range': 2, 'k.outLvl': 0.85, 'k.noiseLvl': 0.2,
      's.drive': 0.2, 'w.mix': 0.78, 'w.decay': 0.42, 'w.vol': 0.75,
      'f.hp': 0.12, 'f.lp': 0.78, 'f.lpRes': 0.3, 'x.type': 0, 'x.amt': 0.25,
      'd.sync': 3, 'd.fb': 0.42, 'd.mix': 0.28, 'd.pp': 1, 'r.size': 0.5, 'r.mix': 0.18,
      'g.root': 9, 'g.scale': 4, 'amt.w.noteR': 0.3, 'amt.f.lp': 0.25,
    },
    cables: [['u.div2', 'k.trig'], ['c.step', 'w.noteR'], ['u.drift', 'f.lp']],
    wingie: { mode: [1, 2], oct: [0, -1], seq: [[9, 9, 16, 9, 12, 9, 19, 16], [9, 16, 14, 12]] },
  },
  {
    name: 'Kosmische Höhle',
    note: 'The clock triangle drives TRIG through all three levels for accented noise hits into two Wingie caves. Drift breathes on the decay.',
    params: {
      'c.lock': 0, 'c.rate': 0.2, 'c.mode': 0, 'c.glide': 0.4,
      'k.drum': 0.17, 'k.pitch': 0.5, 'k.decay': 0.75, 'k.range': 3, 'k.noiseLvl': 0.45,
      'w.mix': 0.9, 'w.decay': 0.85, 'w.vol': 0.7, 'f.hp': 0.15, 'f.lp': 0.7, 'f.lpRes': 0.15,
      'x.type': 0, 'x.amt': 0.2, 'd.sync': 0, 'd.time': 0.75, 'd.fb': 0.55, 'd.mix': 0.3, 'd.wow': 0.5,
      'r.size': 0.85, 'r.damp': 0.35, 'r.mix': 0.45, 'u.drift': 0.15,
      'amt.w.decay': 0.3, 'amt.k.pitch': 0.3,
    },
    cables: [['c.tri', 'k.trig'], ['u.drift', 'w.decay'], ['c.step', 'k.pitch']],
    wingie: { mode: [3, 3], oct: [0, 1] },
  },
  {
    name: 'Bar Ostinato',
    note: '16th-note kick-sample pulses in E phrygian. Quantised steps play the Kastle pitch and transpose the left bar.',
    params: {
      'c.lock': 1, 'c.bpm': 112, 'c.mode': 1,
      'k.drum': 0.42, 'k.pitch': 0.3, 'k.decay': 0.6, 'k.qnt': 1, 'k.range': 1.5,
      'w.mix': 0.75, 'w.decay': 0.38, 'w.vol': 0.7, 'f.hp': 0.18, 'f.lp': 0.72, 'f.lpRes': 0.35,
      'x.type': 1, 'x.amt': 0.3, 'd.sync': 3, 'd.fb': 0.35, 'd.mix': 0.22, 'r.mix': 0.15,
      'g.root': 4, 'g.scale': 3, 'amt.k.pitch': 0.35, 'amt.w.noteL': 0.25,
    },
    cables: [['u.div2', 'k.trig'], ['c.step', 'k.pitch'], ['c.step', 'w.noteL']],
    wingie: { mode: [2, 2], oct: [0, -1], seq: [[4, 5, 4, 7], [4, 11, 9, 7]] },
  },
  {
    name: 'Harmonia Chords',
    note: '8th-note pulses ring two Poly chords. The Kastle envelope opens the low-pass for a pumping wah.',
    params: {
      'c.lock': 1, 'c.bpm': 118,
      'k.drum': 0.1, 'k.pitch': 0.45, 'k.decay': 0.68, 'k.noiseLvl': 0.3,
      'w.mix': 0.85, 'w.decay': 0.55, 'w.vol': 0.7,
      'f.hp': 0.1, 'f.lp': 0.45, 'f.lpRes': 0.45, 'amt.f.lp': 0.35,
      'x.type': 1, 'x.amt': 0.3, 'd.sync': 4, 'd.fb': 0.35, 'd.mix': 0.25, 'r.size': 0.6, 'r.mix': 0.25,
      'g.root': 9, 'g.scale': 2, 'm.vol': 0.5,
    },
    cables: [['u.div4', 'k.trig'], ['k.env', 'f.lp']],
    wingie: { mode: [0, 0], poly: [[57, 60, 64], [67, 72, 76]] },
  },
  {
    name: 'Can Loop',
    note: 'Accented hi-hat 16ths. A ÷3 square advances the melody, 3 against 4. Drift sweeps the folder.',
    params: {
      'c.lock': 1, 'c.bpm': 100, 'amt.k.trig': 0.6,
      'k.drum': 0.8, 'k.pitch': 0.55, 'k.decay': 0.7, 'k.noiseLvl': 0.5,
      's.fold': 0.25, 'amt.s.fold': 0.4, 'u.drift': 0.35,
      'w.mix': 0.8, 'w.decay': 0.45, 'w.threshL': 1, 'w.threshR': 1,
      'f.hp': 0.2, 'f.lp': 0.8, 'f.lpRes': 0.25, 'x.type': 0, 'x.amt': 0.35,
      'd.sync': 2, 'd.fb': 0.45, 'd.mix': 0.3, 'd.pp': 1, 'r.mix': 0.15,
      'g.root': 2, 'g.scale': 2,
    },
    cables: [['u.div2', 'k.trig'], ['u.div3', 'w.adv'], ['u.drift', 's.fold']],
    wingie: { mode: [1, 2], oct: [0, -1], seq: [[2, 5, 7, 9, 12], [2, 9, 14]] },
  },
  {
    name: 'Ratio Bells',
    note: 'Just-intonation Ratio voices in La Monte Young\'s Well-Tuned Piano, struck by snare noise on a slow clock.',
    params: {
      'c.lock': 0, 'c.rate': 0.32, 'c.mode': 2, 'c.glide': 0.2,
      'k.drum': 0.62, 'k.pitch': 0.6, 'k.decay': 0.6, 'k.noiseLvl': 0.35,
      'w.mix': 0.92, 'w.decay': 0.9, 'w.vol': 0.65, 'w.tuning': 3,
      'f.hp': 0.2, 'f.lp': 0.82, 'x.amt': 0.1, 'd.sync': 0, 'd.time': 0.62, 'd.fb': 0.4, 'd.mix': 0.25,
      'r.size': 0.75, 'r.mix': 0.35, 'amt.w.noteL': 0.25, 'm.vol': 0.8,
    },
    cables: [['u.div4', 'k.trig'], ['c.step', 'w.noteL']],
    wingie: {
      mode: [4, 4], ratioNotes: [[48, 55, 60], [60, 67, 72]],
      ratios: [1, 1.5, 2.25, 1, 1.25, 1.875, 1, 1.75, 2.625],
    },
  },
  {
    name: 'Init',
    note: 'A clean starting point: 16th-note FM hits into a single String note.',
    params: {},
    cables: [['u.div2', 'k.trig']],
    wingie: {},
  },
];
