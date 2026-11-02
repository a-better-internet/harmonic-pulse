# Harmonic Pulse

A browser instrument for melodic, motorik pulses. An emulated **Bastl Kastle Drum**, with its patch bay, clock and stepped-voltage generator, fires into a **Wingie2-style modal resonator**. The Wingie turns every drum hit into a pitched, ringing note. The result then runs through high- and low-pass filters, wave shapers, a tape echo and a reverb.

Everything runs in one AudioWorklet, so each patch cable is sample-accurate and there is no build step.

```
 CLOCK ─ square / triangle / stepped voltage ─┐
 DIVIDE ÷2 ÷3 ÷4 ÷8 · DRIFT LFO ──────────────┤   patch bay
                                               ▼
 KASTLE DRUM ─► SHAPE ─► WINGIE ─► HP ─► LP ─► COLOUR ─► TAPE ECHO ─► REVERB ─► OUT
 (VCO chip)     drive    2 × 9 modal          tape/tube   synced to
                fold     resonators           fold/fuzz   the clock
                bits     5 modes
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

  Kastle hits often overlap without falling back under the threshold, so the follower also re-arms on a relative drop. That way every hit still advances the note.
- **The firmware's eight alternate tunings** (Centaur, Harp of New Albion, Well-Tuned Piano…) and A3 tuning.

### Patch bay

Square jacks are outputs and round jacks are inputs. Drag between two jacks, or click one and then the other. Click a cable to unplug it, or double-click a jack to unplug everything on it. Every input has an attenuverter. Inputs sum with their knob.

| Outputs | Inputs |
|---|---|
| Kastle Out, Noises, Env | Kastle Trig, Drum, Pitch (Pitch mod), Decay |
| Clock, Tri, Step | Clock Rate, Step clk |
| ÷2, ÷3, ÷4, ÷8, Drift | Wingie Note L, Note R (quantised to the key), Adv, Decay |
| Wingie Trig L, Trig R, Env | Shape Fold, Filter LP, HP |

The Wingie's trigger and envelope outputs can be patched back into the Kastle to create feedback rhythms.

## Playing

- **Patches.** Seven factory patches cover the range:
  - **Motorik**: a Neu!-style steady 16th pulse.
  - **Kosmische Höhle**: cave drones.
  - **Bar Ostinato**: E phrygian.
  - **Harmonia Chords**: envelope-pumped poly chords.
  - **Can Loop**: ÷3 melodic advance over 16ths.
  - **Ratio Bells**: just intonation.
  - **Init**: a clean start.

  **Random** builds a new, musical patch. Save keeps patches in this browser, and Export/Import moves them around as JSON. The current state autosaves.
- **Record** writes a 16-bit stereo WAV of the output.
- **Keys:**
  - `Space`: hit the drum.
  - `Esc`: cancel patching.
  - `Shift`-click a Wingie key: append a note.
  - Knobs: drag, scroll or use the arrow keys; double-click to reset.
- **MIDI.** Notes on channel 1 go to Wingie L, channel 2 to Wingie R, and channel 3 alternates. Channel 10 hits the drum. CC 1, 7 and 11 control decay, volume and mix, as on the Wingie.

## Tests

```bash
npm test
```

`npm test` runs the DSP headlessly in Node. It covers:

- every drum style for stability;
- 3-level trigger behaviour;
- sequencer advance counts;
- resonator pitch accuracy;
- the energy guard;
- scale quantisation;
- that UI, preset and DSP ids stay in sync;
- that every preset renders audibly.

```bash
npm run test:browser
```

`npm run test:browser` drives the real page in headless Chromium and needs Playwright and the dev server on port 8765. It covers patching by drag and by click, building a sequence, cycling modes, presets, saving and WAV recording.

`tools/extract_kastle_samples.py` regenerates `src/dsp/kastle-samples.js` from the firmware's `TR_HH_AT.h`.

## Layout

```
index.html                       page shell
src/dsp/harmonic-pulse-processor.js   the whole signal path (AudioWorklet)
src/dsp/kastle-samples.js        sample tables from the Kastle firmware (generated)
src/engine.js                    AudioContext, worklet messaging, WAV recorder
src/main.js                      UI controller, presets, MIDI
src/ui/knob.js, src/ui/patchbay.js
src/params.js, src/patch-def.js, src/presets.js, src/music.js
```

## Credits and licensing

This is an independent emulation, not affiliated with Bastl Instruments or Meng Qi.

- **Kastle Drum** firmware and sample data © Václav Peloušek / Bastl Instruments 2020, released under **CC BY-SA**.
- **Wingie2** firmware and DSP © Meng Qi, Dave Seidel and contributors. The repository is licensed **GPL-3.0**. The `Wingie2.dsp` file header declares BSD.

This project ports code and data from both, so it is a derivative work. Pick a licence for it that is compatible with both before you publish it. CC BY-SA 4.0 material can be included in GPL-3.0 projects, so GPL-3.0 is the natural choice.
