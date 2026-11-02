// Sample kits for the Kastle's four sample slots, built from the tables in
// the firmware's bastlAttinySamples folder. Slot order: hat (NOISE, HAT and
// the NOISES output), kick (KICK), snare (SNARE), clap (CLAP, PWM CLAP).
export const KITS = [
  { name: 'TR (stock)', slots: ['TR_HH', 'KICK2', 'SNARE2', 'TR_CLAP'] },
  { name: 'TR open', slots: ['TR_OH', 'TR_TOM', 'TR_SNARE', 'TR_CB'] },
  { name: 'Game Boy', slots: ['GB_HH', 'GB_KICK', 'GB_SNARE', 'GB_BLIP'] },
  { name: 'GB glitch', slots: ['GB_GLITCH', 'GB_BZZ', 'GB_TUI', 'GB_BLIP'] },
  { name: 'Glitch A', slots: ['GL_A', 'GL_D', 'GL_E', 'GL_F'] },
  { name: 'Glitch B', slots: ['GL_G', 'GL_H', 'GL_I', 'GL_C'] },
  { name: 'Metal', slots: ['HAT2', 'CB', 'CB3', 'RIDE'] },
  { name: 'Acoustic', slots: ['HAT', 'KICK', 'SNARE', 'CB4'] },
];

export const KASTLE_WAVE_NAMES = ['Sine', 'Triangle', 'Saw', 'Square', 'Cheb 3', 'Cheb 4', 'Cheb 5', 'Cheb 6'];
