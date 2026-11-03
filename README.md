# Harmonic Pulse

A browser instrument for melodic, motorik pulses. An emulated **Bastl Kastle Drum**, with its patch bay, clock and stepped-voltage generator, fires into a **Wingie2-style modal resonator**. The Wingie turns every drum hit into a pitched, ringing note. The result then runs through high- and low-pass filters, wave shapers, a tape echo and a reverb.

Everything runs in one AudioWorklet, so each patch cable is sample-accurate and there is no build step.

```
 CLOCK ─ square / triangle / stepped voltage ─┐
 DIVIDE ÷2 ÷3 ÷4 ÷8 · DRIFT · LFO (7 shapes) ─┤   patch bay
                                               ▼
 KASTLE DRUM ──┬─► SHAPE ─► WINGIE ─┬─► HP ─► LP/BP ─► COLOUR ─► TAPE ECHO ─► REVERB ─► OUT
 (VCO chip,    │   drive    2 × 9   │        ▲ env    tape/tube  synced to
  8 wavetables,│   fold     modal   │        │        fold/fuzz  the clock
  8 kits)      │   bits             │      every hit
       hits ───┴─► VOICE ───────────┘
                   sine › tri › saw › pulse, follows the melody
```

## Run it

AudioWorklet needs a secure context, and `http://localhost` counts as one. Any static server works:

```bash
npm start
```

Then open <http://localhost:8000/> and press **Start audio**. With no Node, `python3 -m http.server 8000` works the same way. The `index.html` page plus `src/` can be hosted as-is on any static host that serves HTTPS, such as GitHub Pages.

It runs in current Chrome, Edge, Firefox and Safari. Web MIDI input works where the browser supports it.

## What's emulated, and how faithfully

### Kastle Drum VCO: a port of `kastleDrum.ino`

The ATtiny85 firmware runs at the chip's own rates, using its own 8- and 16-bit integer arithmetic:

| Firmware piece | Rate here |
|---|---|
| `TIMER1_COMPA` ISR (oscillators, FM) | 15 625 Hz (32 MHz PLL ÷ 8 ÷ 256) |
| ADC round-robin `0,1,0,2,0,3`, every other read discarded | ~4 808 conversions/s |
| `loop()`: `synthesis()`, `renderDecay()` | 10 kHz |

What you hear comes straight from that firmware:

- **8 drum styles**, selected by the DRUM knob (`input >> 7`): FM, NOISE (hi-hat sample ring-modulated by a sine), T&H, KICK, SNARE, CLAP, HAT, and a PWM CLAP. The last one reproduces the firmware dropping Timer0's PWM carrier to an audible 3.9 kHz.
- **3-level TRIG input** (thresholds 150 and 162). Every change of level fires a hit. A one-step change is an *accent* (main envelope 128, noise envelope 255), and a two-step jump is a full hit. A square wave gives full hits on **both edges**. The triangle walks through all three levels, giving four accented hits per cycle.
- **"Acceleration charge" envelopes.** Moving DRUM pumps the main envelope and moving PITCH pumps the NOISES envelope, so modulating them makes the drum swell.
- **DECAY doubles as FM depth** (it is `WS_2` in the ISR). Below 100 the pitch envelope engages, and at exactly 100 the envelope holds.
- **The real sample tables** (TR_HH, KICK2, SNARE2, TR_CLAP) are pulled from the firmware headers. That includes NOISE mode's habit of reading past its table into the rest of flash when DECAY is low.
- **XY mode**: the NOISES output carries the envelope instead.

Enhancements are marked in the UI:

- **Range** stretches the envelope; ×1 is the hardware.
- **Quantise** snaps PITCH to the global key and scale, across four octaves.
- **Wave** morphs the chip's wavetable. The firmware has a `writeWave()` that can load sine, triangle, square or saw, but the stock build only ever loads sine. The knob sweeps those four plus the Chebyshev 3–6 tables from `bastlAttinySamples`, crossfading neighbours. The wavetable is used everywhere the firmware reads it: the FM carrier and modulator, the NOISE ring modulator, T&H, and the NOISES glitch comparator. That is why it changes the character of the whole drum, not just its tone.
- **Kit** swaps the four sample slots (hat, kick, snare, clap) for other sets from `bastlAttinySamples`:
  - **TR (stock)** and **TR open**.
  - **Game Boy** and **GB glitch**.
  - **Glitch A** and **Glitch B**.
  - **Metal** (cowbells and ride).
  - **Acoustic**.

The firmware only recalculates pitch when PITCH moves; on the hardware, ADC noise usually does that anyway. The port therefore also refreshes pitch whenever the drum style changes.

### Clock / LFO / stepped generator

The Kastle's second chip isn't in the supplied sources, so this part is rebuilt from its documented behaviour:

- A voltage-controllable clock with square and triangle outputs, plus a BPM lock and tap tempo. In BPM lock, one tick is a 16th note. Because TRIG fires on both edges, Clock → TRIG plays 32nds; use the dividers for slower pulses.
- A stepped voltage generator with **RND**, **8-step loop** and **16-step loop** modes. RND writes each fresh value into the loop memory, so switching to 8 or 16 freezes what you just heard. A Step clk input lets another source clock it.

The **Divide · Drift** module is an addition. Its ÷2, ÷3, ÷4 and ÷8 square waves give hits into TRIG every tick (16ths), every 1.5 ticks (a dotted polyrhythm), every 2 ticks (8ths) and every 4 ticks (quarters). It also has a slow smooth random LFO.

### Wingie2: a port of `Wingie2.dsp` and the firmware's frequency logic

- **9 "controlled modal rotation" resonators per side.** Coefficients update every 32 samples, as in the Faust `modalBlockSize`. The input gain, the `fi.lowpass(1, 4000)` and `ef.cubicnl` clipper, and the pre/post clip gains (`lin2LogGain`) follow the DSP.
- **The anti-feedback energy guard from v4**, which can be switched off.
- **All five modes, using the firmware's frequency layouts:**
  - **Poly**: 3 voices × harmonics 1, 2, 3.
  - **String**: f × 1…9.
  - **Bar**: f × 0.44444 × (i + 1.5)².
  - **Cave**: three editable banks per side, chosen by the octave switch; keys mute resonators.
  - **Ratio**: 3 voices × an editable 9-ratio profile.
- **The threshold sequencer from String/Bar mode.** Tap keys to set a sequence; `Shift`-click or **Append** adds notes. Each hit louder than the threshold steps to the next note. This is what turns a drum loop into a melody.
- **Per-step accents** (an addition). Click a step to cycle it through these levels; right-click or long-press removes it.

  | Level | Resonator | Voice and filter envelope |
  |---|---|---|
  | **Normal** | as the hardware | as struck |
  | **Accent** | struck harder (brighter, more clip) and rings louder | struck 35% harder, deeper sweep |
  | **Ghost** | struck softly and rings quietly | struck softly |
  | **Rest** | not struck; the previous note keeps ringing at its pitch | silent |

  The Voice and filter envelope follow the accents of the side the Voice takes its pitch from. Accents also come in over MIDI: velocity 110 and up is an accent, and below 45 is a ghost. The **Acc L** jack outputs the current left step's level (accent 1, normal 0.5, ghost 0.25, rest 0), so it can be patched to anything.

  Kastle hits often overlap without falling back under the threshold, so the follower also re-arms on a relative drop. That way every hit still advances the note.
- **The firmware's eight alternate tunings** (Centaur, Harp of New Albion, Well-Tuned Piano…) and A3 tuning.
- **Enhancements** for shaping the material:
  - **Damp**: partials above ~300 Hz die sooner, like wood or felt.
  - **Stretch**: bends every partial ratio to r^(1 ± 0.25). Up sounds like bells and metal; down is squeezed and gamelan-like.
  - **Spread**: detunes the sides apart by up to 40 cents.

### Added modules

- **Voice.** A band-limited (PolyBLEP) oscillator that morphs sine › triangle › saw › pulse.
  - **Tone:** Width (PWM), Sub (a square an octave down), Unison (a second oscillator up to +25 cents), Octave, Fine and Glide.
  - **Envelope:** an attack/decay envelope that the Kastle **hits** strike. Accents strike softer. It can also run from a **gate** input, or as a **drone**.
  - **Pitch:** follows the Wingie left or right note, the quantised step voltage, or the key root.
  - **Routing:** **To Wingie** sends it into the resonators as a pitched exciter. **Direct** mixes it in after them, before the filters.
- **LFO.** Sine, triangle, ramp up, ramp down, square, sample & hold and smooth random. It runs free (0.02–20 Hz) or phase-locked to the clock at 1–64 ticks per cycle.
- **Filter envelope.** Every Kastle hit opens the low-pass (or closes it, with a negative amount), with its own decay. **Band-pass** turns the low filter into a resonant band-pass.
- **Perform.** An X/Y pad for live playing:
  - **X → / Y ↑** pick which knob each axis sweeps, each over a range chosen to sound good. The choices are filter cutoff, resonance and envelope; Wingie decay, mix, damp, stretch and spread; Kastle wave, pitch, decay and drum style; Voice wave, width and level; drive, fold and colour; and echo and reverb. The knobs move with your finger.
  - **Latch** on keeps the puck where you let go. With it off, the puck springs back and the knobs return to where they were, which suits sweep-and-release gestures.
  - **X, Y and Gate** are patch outputs. Gate is high while you press, so Gate → TRIG plays the drum with your finger, and Gate → Adv steps the melody.
  - Keyboard: focus the pad, then use the arrow keys (`Shift` for fine moves). Hold `Space` to gate, and `Home` centres it.
- **Colour** now sits inside the Filter module, and **Master** lives in the top bar.

## Dialling in a sound

A good order to work in:

1. **Pulse first.** Patch ÷2 (16ths), ÷4 (8ths) or ÷3 (dotted) into TRIG, and set BPM. Lower the TRIG attenuverter to about 60% for softer accented hits.
2. **Drum colour.** DRUM picks the style, and DECAY sets length (below about 40% the pitch drops like a kick). WAVE reshapes the oscillator, and Kit changes the samples.
3. **Melody.** Put a Wingie side in String or Bar and tap a sequence. Click steps to accent the downbeats, ghost the in-betweens and drop a rest for breathing room. Patch Step into Note L or Note R for variations that stay in the key.
4. **Material.** Wingie Decay sets the ring length. Damp makes it woodier, Stretch makes it more bell-like, and Spread makes it wider.
5. **Voice on top.** Raise Direct for a sequencer-bass line that plays the same melody, or To Wingie to excite the resonators with a pitched tone. Try a saw with Unison and a little Glide.
6. **Shape it.** Use the filter cutoff, resonance and Env amt for a squelch on every hit. An LFO into LP or PWM adds a slow sweep, and Colour adds saturation.
7. **Space.** A synced echo at 3 ticks gives a dotted-8th motorik delay. Add reverb to taste.

### Patch bay

Square jacks are outputs and round jacks are inputs. Drag between two jacks, or click one and then the other. Hold `Alt` and click a cable to unplug it, or double-click a jack to unplug everything on it. Every input has an attenuverter. Inputs sum with their knob.

| Outputs | Inputs |
|---|---|
| Kastle Out, Noises, Env | Kastle Trig, Drum, Pitch (Pitch mod), Decay |
| Clock, Tri, Step | Clock Rate, Step clk |
| ÷2, ÷3, ÷4, ÷8, Drift | Wingie Note L, Note R (quantised to the key), Adv, Decay |
| Wingie Trig L, Trig R, Env | Shape Fold, Filter LP, HP |
| Voice Out, Env; LFO | Kastle Wave; Voice Pitch, Wave, PWM, Gate; LFO Rate |
| Wingie Acc L; Perform X, Y, Gate | |

The Wingie's trigger and envelope outputs can be patched back into the Kastle to create feedback rhythms.

## Playing

- **Patches.** Eleven factory patches cover the range:
  - **Motorik**: a Neu!-style steady 16th pulse.
  - **Kosmische Höhle**: cave drones.
  - **Bar Ostinato**: E phrygian.
  - **Harmonia Chords**: envelope-pumped poly chords.
  - **Can Loop**: ÷3 melodic advance over 16ths.
  - **Ratio Bells**: just intonation.
  - **Phaedra Sequence**: a gliding saw Voice on the stepped generator, with a filter envelope and a bar-long LFO sweep.
  - **Autobahn Pulse**: a square Voice with sub, its pulse width modulated by a synced LFO.
  - **Gamelan Stretch**: a Chebyshev wavetable striking squeezed, damped bars; sample & hold walks the wavetable.
  - **Glitch Lattice**: glitch-kit hats into two caves, through a band-pass.
  - **Init**: a clean start.

  **Random** builds a new, musical patch. Save keeps patches in this browser, and Export/Import moves them around as JSON. The current state autosaves.
- **Record** writes a 16-bit stereo WAV of the output.
- **Keys:**
  - `Space`: hit the drum.
  - `Esc`: cancel patching.
  - `Shift`-click a Wingie key: append a note.
  - `Alt`-click a cable: unplug it. Cables otherwise let clicks through to the controls beneath them.
  - Knobs: drag, scroll or use the arrow keys; double-click to reset.
- **MIDI.** Notes on channel 1 go to Wingie L, channel 2 to Wingie R, and channel 3 alternates. Channel 10 hits the drum. CC 1, 7 and 11 control decay, volume and mix, as on the Wingie.

## Tests

```bash
npm test
```

`npm test` runs the DSP headlessly in Node. It covers:

- every drum style × wave × kit combination for stability;
- the wave morph landing exactly on the firmware tables;
- Voice pitch tracking and its envelope;
- LFO clock sync;
- the filter envelope;
- Damp, Stretch and Spread;
- 3-level trigger behaviour;
- sequencer advance counts;
- resonator pitch accuracy;
- the energy guard;
- scale quantisation;
- accents: rests hold pitch and still advance, accents ring harder than ghosts, the Voice strike level, and the Acc L jack;
- the Perform pad's patch outputs;
- that UI, preset and DSP ids stay in sync;
- that every preset renders audibly.

```bash
npm run test:browser
```

`npm run test:browser` drives the real page in headless Chromium and needs Playwright and the dev server on port 8765. It covers patching by drag and by click, Alt-click unplugging, building a sequence, cycling and dropping step accents, cycling modes, the new modules, the X/Y pad (knob sweeps and latch spring-back), presets, saving and WAV recording.

`tools/extract_kastle_samples.py` regenerates `src/dsp/kastle-samples.js` from the firmware folder: `TR_HH_AT.h`, every `bastlAttinySamples/*_AT.h` sample, and the CHEB3–6 wavetables.

## Layout

```
index.html                       page shell
src/dsp/harmonic-pulse-processor.js   the whole signal path (AudioWorklet)
src/dsp/kastle-samples.js        sample tables from the Kastle firmware (generated)
src/engine.js                    AudioContext, worklet messaging, WAV recorder
src/main.js                      UI controller, presets, MIDI
src/ui/knob.js, src/ui/patchbay.js, src/ui/xypad.js
src/params.js, src/patch-def.js, src/presets.js, src/music.js, src/kits.js
```

## Credits and licensing

This is an independent emulation, not affiliated with Bastl Instruments or Meng Qi.

- **Kastle Drum** firmware and sample data © Václav Peloušek / Bastl Instruments 2020, released under **CC BY-SA**.
- **Wingie2** firmware and DSP © Meng Qi, Dave Seidel and contributors. The repository is licensed **GPL-3.0**. The `Wingie2.dsp` file header declares BSD.

This project ports code and data from both, so it is a derivative work. Pick a licence for it that is compatible with both before you publish it. CC BY-SA 4.0 material can be included in GPL-3.0 projects, so GPL-3.0 is the natural choice.
