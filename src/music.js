// Scales for the quantisers and the Wingie2 alternate tunings.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const SCALES = [
  { name: 'Minor pentatonic', steps: [0, 3, 5, 7, 10] },
  { name: 'Major pentatonic', steps: [0, 2, 4, 7, 9] },
  { name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  { name: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
  { name: 'Aeolian', steps: [0, 2, 3, 5, 7, 8, 10] },
  { name: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  { name: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
  { name: 'Harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  { name: 'Hirajoshi', steps: [0, 2, 3, 7, 8] },
  { name: 'Whole tone', steps: [0, 2, 4, 6, 8, 10] },
  { name: 'Fifths', steps: [0, 7] },
  { name: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
];

// From the Wingie2 firmware (Wingie2.ino): ratios per scale degree from C.
export const ALT_TUNINGS = [
  { name: 'Centaur (Kraig Grady)', ratios: [1, 21 / 20, 9 / 8, 7 / 6, 5 / 4, 4 / 3, 7 / 5, 3 / 2, 14 / 9, 5 / 3, 7 / 4, 15 / 8] },
  { name: 'Harp of New Albion (Terry Riley)', ratios: [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 64 / 45, 3 / 2, 8 / 5, 5 / 3, 16 / 9, 15 / 8] },
  { name: 'Carlos Harmonic (Wendy Carlos)', ratios: [1, 17 / 16, 9 / 8, 19 / 16, 5 / 4, 21 / 16, 11 / 8, 3 / 2, 13 / 8, 27 / 16, 7 / 4, 15 / 8] },
  { name: 'Well-Tuned Piano (La Monte Young)', ratios: [1, 567 / 512, 9 / 8, 147 / 128, 21 / 16, 1323 / 1024, 189 / 128, 3 / 2, 49 / 32, 7 / 4, 441 / 256, 63 / 32] },
  { name: 'Meta Slendro (Grady/Wilson)', ratios: [1, 65 / 64, 9 / 8, 37 / 32, 151 / 128, 5 / 4, 21 / 16, 43 / 32, 3 / 2, 49 / 32, 7 / 4, 57 / 32] },
  { name: 'Bihexany (Gene Ward Smith)', ratios: [1, 35 / 33, 7 / 6, 5 / 4, 14 / 11, 15 / 11, 3 / 2, 35 / 22, 5 / 3, 7 / 4, 20 / 11, 21 / 11] },
  { name: 'Hexachordal Dodecaphonic (Erlich)', ratios: [1, 1.065041, 1.134313, 1.208089, 1.286664, 1.328624, 1.414214, 1.506196, 1.60416, 1.708496, 1.819619, 1.937969] },
  { name: 'Augmented[12] (Smith/Erlich)', ratios: [1, 1.096825, 1.148698, 1.203025, 1.259921, 1.381913, 1.447269, 1.515717, 1.587401, 1.741101, 1.823445, 1.909683] },
];
