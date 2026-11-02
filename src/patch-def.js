// Patch bay ports. Ids must match SOURCES / DESTS in the worklet.

export const OUTPUTS = {
  'k.out': { label: 'Out', title: 'Kastle main output (audio)' },
  'k.noise': { label: 'Noises', title: 'Kastle NOISES output (audio)' },
  'k.env': { label: 'Env', title: 'Kastle main envelope (0..1)' },
  'c.clk': { label: 'Clock', title: 'Clock square, one cycle per tick (into TRIG: two hits per tick)' },
  'c.tri': { label: 'Tri', title: 'Clock triangle LFO' },
  'c.step': { label: 'Step', title: 'Stepped voltage (random / 8 / 16-step loop)' },
  'u.div2': { label: '÷2', title: 'Clock ÷ 2 square (into TRIG: a hit every tick, 16ths in BPM lock)' },
  'u.div3': { label: '÷3', title: 'Clock ÷ 3 square (into TRIG: a hit every 1.5 ticks, dotted polyrhythm)' },
  'u.div4': { label: '÷4', title: 'Clock ÷ 4 square (into TRIG: 8th notes in BPM lock)' },
  'u.div8': { label: '÷8', title: 'Clock ÷ 8 square (into TRIG: quarter notes in BPM lock)' },
  'u.drift': { label: 'Drift', title: 'Slow smooth random LFO' },
  'w.trigL': { label: 'Trig L', title: 'Wingie left threshold gate' },
  'w.trigR': { label: 'Trig R', title: 'Wingie right threshold gate' },
  'w.env': { label: 'Env', title: 'Wingie output envelope follower' },
  'o.out': { label: 'Out', title: 'Voice oscillator (audio)' },
  'o.env': { label: 'Env', title: 'Voice envelope' },
  'l.out': { label: 'LFO', title: 'LFO output (0..1)' },
};

export const INPUTS = {
  'k.trig': { label: 'Trig', title: '3-level trigger: low / mid / high. Every change of level fires a hit, so a square hits on both edges; a one-step change is an accent.' },
  'k.drum': { label: 'Drum', title: 'Drum style CV (adds to the DRUM knob). Movement charges the envelope.' },
  'k.pitch': { label: 'Pitch', title: 'Pitch CV through the PITCH MOD attenuator. Movement charges the NOISES envelope.' },
  'k.decay': { label: 'Decay', title: 'Decay CV (below 100 the pitch envelope engages)' },
  'c.rate': { label: 'Rate', title: 'Clock rate CV (ignored in BPM lock)' },
  'c.stepclk': { label: 'Step clk', title: 'Clocks the stepped generator (normalled to the clock)' },
  'w.noteL': { label: 'Note L', title: 'Transposes the left resonator, quantised to the key' },
  'w.noteR': { label: 'Note R', title: 'Transposes the right resonator, quantised to the key' },
  'w.adv': { label: 'Adv', title: 'Advances both String/Bar note sequences on each rising edge' },
  'w.decay': { label: 'Decay', title: 'Resonator decay CV' },
  's.fold': { label: 'Fold', title: 'Wavefolder amount CV' },
  'f.lp': { label: 'LP', title: 'Low-pass cutoff CV' },
  'f.hp': { label: 'HP', title: 'High-pass cutoff CV' },
  'k.wave': { label: 'Wave', title: 'Kastle wavetable morph CV' },
  'o.pitch': { label: 'Pitch', title: 'Transposes the voice, quantised to the key' },
  'o.wave': { label: 'Wave', title: 'Voice waveform morph CV' },
  'o.pwm': { label: 'PWM', title: 'Pulse width modulation' },
  'o.gate': { label: 'Gate', title: 'Strikes the voice on rising edges (Trigger: Gate in)' },
  'l.rate': { label: 'Rate', title: 'LFO rate CV (free mode)' },
};

export const CABLE_COLORS = ['#e8b64c', '#e2574c', '#46b3a8', '#8f7cf0', '#e6e1d3', '#f08a3c', '#58a6e8', '#c4d65a'];
