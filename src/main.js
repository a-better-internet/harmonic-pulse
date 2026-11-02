import { Engine } from './engine.js';
import { Knob } from './ui/knob.js';
import { PatchBay } from './ui/patchbay.js';
import { PARAMS, defaultParams, DRUM_STYLES, STEP_MODES, SYNC_LABELS, COLOR_TYPES, WINGIE_MODES, drumStyle,
  LFO_SHAPES, LFO_SYNC, VOICE_SOURCES, VOICE_TRIGS } from './params.js';
import { KITS } from './kits.js';
import { KASTLE_WAVES } from './dsp/kastle-samples.js';
import { INPUTS, OUTPUTS } from './patch-def.js';
import { PRESETS, defaultWingie } from './presets.js';
import { NOTE_NAMES, SCALES, ALT_TUNINGS } from './music.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const clone = (o) => JSON.parse(JSON.stringify(o));
const GATE_INPUTS = new Set(['k.trig', 'c.stepclk', 'w.adv', 'o.gate']);
const W_POLY = 0, W_STRING = 1, W_BAR = 2, W_CAVE = 3, W_RATIO = 4;
const BASE_NOTE = 48;

// ---------------------------------------------------------------------------
// storage (never required: private windows may throw)
// ---------------------------------------------------------------------------
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } },
};

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------
function amtDefault(dest) { return GATE_INPUTS.has(dest) ? 1 : 0.5; }

function fullDefaults() {
  const p = defaultParams();
  for (const d of Object.keys(INPUTS)) p['amt.' + d] = amtDefault(d);
  return p;
}

function normaliseWingie(w) {
  const base = defaultWingie();
  const out = Object.assign(base, clone(w || {}));
  for (const ch of [0, 1]) {
    if (!Array.isArray(out.seq[ch]) || !out.seq[ch].length) out.seq[ch] = [9];
  }
  return out;
}

function fromPreset(preset) {
  return {
    params: Object.assign(fullDefaults(), preset.params || {}),
    cables: clone(preset.cables || []),
    wingie: normaliseWingie(preset.wingie),
  };
}

function sanitiseState(s) {
  const params = fullDefaults();
  if (s && s.params) {
    for (const [k, v] of Object.entries(s.params)) if (k in params && typeof v === 'number' && Number.isFinite(v)) params[k] = v;
  }
  const cables = Array.isArray(s && s.cables)
    ? s.cables.filter((c) => Array.isArray(c) && c[0] in OUTPUTS && c[1] in INPUTS)
    : [];
  return { params, cables, wingie: normaliseWingie(s && s.wingie) };
}

let state = sanitiseState(store.get('hp.autosave', null) || fromPreset(PRESETS[0]));
let userPresets = store.get('hp.user', []);
let lastMeter = null;
let seqResetPending = [false, false];

let saveTimer = 0;
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.set('hp.autosave', state), 400);
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------------------------------------------------------------------------
// engine
// ---------------------------------------------------------------------------
const engine = new Engine({
  onMeter: (m) => { lastMeter = m; },
  onError: (e) => { console.error(e); toast('Audio error: ' + e.message.split('\n')[0]); },
});

function pushAll(resetSeq = [true, true]) {
  engine.setParams(state.params);
  engine.setCables(state.cables);
  engine.setWingie(state.wingie, resetSeq);
}

// ---------------------------------------------------------------------------
// params & controls
// ---------------------------------------------------------------------------
const knobs = {};
const toggles = {};
const listeners = []; // (id, value) => void, for derived UI

function setParam(id, v, { emit = true, ui = true } = {}) {
  state.params[id] = v;
  if (emit) engine.setParams({ [id]: v });
  if (ui) {
    if (knobs[id]) knobs[id].set(v);
    if (toggles[id]) toggles[id].setAttribute('aria-pressed', v > 0.5 ? 'true' : 'false');
  }
  for (const fn of listeners) fn(id, v);
  autosave();
}

function buildKnob(el) {
  const id = el.dataset.knob;
  const size = el.dataset.size || 'md';
  if (id.startsWith('amt.')) {
    const dest = id.slice(4);
    knobs[id] = new Knob(el, {
      label: el.dataset.label || 'amt', min: -1, max: 1, def: amtDefault(dest), bipolar: true, size,
      value: state.params[id], fmt: (v) => `${Math.round(v * 100)}%`,
      title: 'Attenuverter for this input',
      onChange: (v) => setParam(id, v, { ui: false }),
    });
    return;
  }
  const p = PARAMS[id];
  if (!p) { console.warn('unknown knob', id); return; }
  knobs[id] = new Knob(el, {
    label: p.label, min: p.min, max: p.max, def: p.def, step: p.step, size, bipolar: !!p.bipolar,
    value: state.params[id], fmt: p.fmt, title: el.title || p.title,
    onChange: (v) => setParam(id, v, { ui: false }),
  });
}

function buildToggle(el) {
  const id = el.dataset.toggle;
  const p = PARAMS[id];
  const b = document.createElement('button');
  b.className = 'toggle';
  b.type = 'button';
  b.innerHTML = `<span class="toggle-led" aria-hidden="true"></span><span>${p.label}</span>`;
  if (el.title) b.title = el.title;
  b.setAttribute('aria-pressed', state.params[id] > 0.5 ? 'true' : 'false');
  b.addEventListener('click', () => setParam(id, state.params[id] > 0.5 ? 0 : 1));
  el.replaceWith(b);
  toggles[id] = b;
}

function buildSeg(container, id, labels) {
  container.innerHTML = '';
  labels.forEach((lab, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = lab;
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => setParam(id, i));
    container.appendChild(b);
  });
  const sync = () => {
    const v = Math.round(state.params[id]);
    $$('button', container).forEach((b, i) => b.setAttribute('aria-checked', i === v ? 'true' : 'false'));
  };
  listeners.push((pid) => { if (pid === id) sync(); });
  sync();
}

function buildSelect(sel, id, options) {
  sel.innerHTML = '';
  for (const [value, label] of options) {
    const o = document.createElement('option');
    o.value = String(value);
    o.textContent = label;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => setParam(id, Number(sel.value)));
  const sync = () => { sel.value = String(Math.round(state.params[id])); };
  listeners.push((pid) => { if (pid === id) sync(); });
  sync();
}

// ---------------------------------------------------------------------------
// patch bay
// ---------------------------------------------------------------------------
const rack = $('#rack');
const patch = new PatchBay(rack, $('#cables'), {
  onChange: (list) => {
    state.cables = list;
    engine.setCables(list);
    autosave();
  },
  onArm: (port) => {
    if (port) toast(`Patching from ${port}. Click a ${patch.jacks.get(port).dir === 'out' ? 'round input' : 'square output'} jack, or press Esc.`);
  },
});

function buildJacks() {
  for (const cell of $$('.jack-cell')) {
    const isIn = !!cell.dataset.in;
    const port = isIn ? cell.dataset.in : cell.dataset.out;
    const def = isIn ? INPUTS[port] : OUTPUTS[port];
    const jack = document.createElement('button');
    jack.type = 'button';
    jack.className = `jack ${isIn ? 'in' : 'out'}`;
    jack.title = `${def.title}${isIn ? '' : ' (output)'}`;
    jack.setAttribute('aria-label', `${isIn ? 'Input' : 'Output'} ${def.label}`);
    const lab = document.createElement('span');
    lab.className = 'jack-label';
    lab.textContent = def.label;
    cell.append(jack, lab);
    patch.registerJack(jack, port, isIn ? 'in' : 'out');
    if (isIn) {
      const k = document.createElement('div');
      k.dataset.knob = 'amt.' + port;
      k.dataset.size = 'xs';
      k.dataset.label = cell.dataset.amtLabel || 'amt';
      cell.appendChild(k);
      buildKnob(k);
    }
  }
}

// ---------------------------------------------------------------------------
// Wingie panel
// ---------------------------------------------------------------------------
const wingieUI = [];
const appendLatch = [false, false];

function noteName(n) { return NOTE_NAMES[((n % 12) + 12) % 12] + Math.floor(n / 12 - 1); }

function sendWingie(resetSeq) {
  engine.setWingie(state.wingie, resetSeq || [false, false]);
  autosave();
  renderWingie();
}

function channelBase(ch) { return BASE_NOTE + state.wingie.oct[ch] * 12 + (ch ? 12 : 0); }

function pressKey(ch, i, append) {
  const w = state.wingie;
  const m = w.mode[ch];
  if (m === W_POLY || m === W_RATIO) {
    const notes = m === W_POLY ? w.poly : w.ratioNotes;
    const nextKey = m === W_POLY ? 'polyNext' : 'ratioNext';
    notes[ch][w[nextKey][ch]] = i + channelBase(ch);
    w[nextKey][ch] = (w[nextKey][ch] + 1) % 3;
    sendWingie();
  } else if (m === W_STRING || m === W_BAR) {
    if (append) {
      if (w.seq[ch].length >= 64) w.seq[ch].shift();
      w.seq[ch].push(i);
      sendWingie();
    } else {
      w.seq[ch] = [i];
      sendWingie(ch ? [false, true] : [true, false]);
    }
  } else if (m === W_CAVE) {
    const bank = w.oct[ch] + 1;
    const mute = w.caveMute[ch][bank];
    if (i < 9) mute[i] = !mute[i];
    else if (i === 9) mute.fill(false);
    else if (i === 10) mute.fill(true);
    sendWingie();
  }
}

function buildWingieSide(el, ch) {
  el.innerHTML = `
    <div class="w-ch-head">
      <span class="w-ch-name">${ch ? 'R' : 'L'}</span>
      <button type="button" class="w-mode" title="Mode: Poly, String, Bar, Cave or Ratio"><span class="w-led"></span><span class="w-mode-name"></span></button>
      <span class="lamp w-trig" title="Threshold gate"></span>
    </div>
    <div class="seg w-oct" role="radiogroup" aria-label="Octave">
      <button type="button" data-o="-1">−1</button><button type="button" data-o="0">0</button><button type="button" data-o="1">+1</button>
    </div>
    <div class="w-keys" role="group" aria-label="Note keys"></div>
    <div class="w-info"></div>
    <div class="w-tools">
      <button type="button" class="toggle w-append" aria-pressed="false" title="Add notes to the sequence instead of replacing it (or hold Shift)"><span class="toggle-led"></span><span>Append</span></button>
      <button type="button" class="btn small w-clear" title="Reset the sequence to its first note">Clear</button>
      <div data-knob="w.thresh${ch ? 'R' : 'L'}" data-size="sm" title="Level that advances the String/Bar sequence (max = off)"></div>
    </div>`;
  const keys = $('.w-keys', el);
  const whites = [0, 2, 4, 5, 7, 9, 11];
  for (let i = 0; i < 12; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    const isWhite = whites.includes(i);
    b.className = `w-key ${isWhite ? 'white' : 'black'}`;
    b.style.gridColumn = isWhite ? `${whites.indexOf(i) * 2 + 1} / span 2` : `${[0, 2, 0, 4, 0, 0, 8, 0, 10, 0, 12][i]} / span 2`;
    b.style.gridRow = isWhite ? '2' : '1';
    b.dataset.i = String(i);
    b.addEventListener('click', (e) => pressKey(ch, i, e.shiftKey || appendLatch[ch]));
    keys.appendChild(b);
  }
  $('.w-mode', el).addEventListener('click', () => {
    state.wingie.mode[ch] = (state.wingie.mode[ch] + 1) % 5;
    sendWingie(ch ? [false, true] : [true, false]);
  });
  $$('.w-oct button', el).forEach((b) => b.addEventListener('click', () => {
    state.wingie.oct[ch] = Number(b.dataset.o);
    sendWingie();
  }));
  const app = $('.w-append', el);
  app.addEventListener('click', () => {
    appendLatch[ch] = !appendLatch[ch];
    app.setAttribute('aria-pressed', String(appendLatch[ch]));
  });
  $('.w-clear', el).addEventListener('click', () => {
    state.wingie.seq[ch] = [state.wingie.seq[ch][0] ?? 9];
    sendWingie(ch ? [false, true] : [true, false]);
  });
  buildKnob($('[data-knob]', el));
  wingieUI[ch] = { el, keys: $$('.w-key', el), info: $('.w-info', el), led: $('.w-led', el), name: $('.w-mode-name', el), trig: $('.w-trig', el), oct: $$('.w-oct button', el) };
}

function renderWingie() {
  const w = state.wingie;
  for (const ch of [0, 1]) {
    const ui = wingieUI[ch];
    if (!ui) continue;
    const m = w.mode[ch];
    ui.name.textContent = WINGIE_MODES[m].name;
    ui.led.style.background = WINGIE_MODES[m].led;
    ui.el.dataset.mode = String(m);
    ui.oct.forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.o) === w.oct[ch])));
    const lit = new Set();
    const bank = w.oct[ch] + 1;
    ui.keys.forEach((k, i) => {
      if (m === W_CAVE) {
        k.textContent = i < 9 ? String(i + 1) : i === 9 ? 'on' : i === 10 ? 'off' : '';
        k.title = i < 9 ? `Resonator ${i + 1}: ${w.cave[ch][bank][i]} Hz (click to mute/unmute)` : i === 9 ? 'Unmute all' : i === 10 ? 'Mute all' : '';
        if (i < 9 && !w.caveMute[ch][bank][i]) lit.add(i);
      } else {
        k.textContent = NOTE_NAMES[i].length === 1 ? NOTE_NAMES[i] : '';
        k.title = NOTE_NAMES[i];
      }
    });
    let info = '';
    if (m === W_POLY || m === W_RATIO) {
      const notes = m === W_POLY ? w.poly[ch] : w.ratioNotes[ch];
      const next = (m === W_POLY ? w.polyNext : w.ratioNext)[ch];
      notes.forEach((n) => lit.add(((n % 12) + 12) % 12));
      info = notes.map((n, v) => `<span class="chip${v === next ? ' next' : ''}" title="Voice ${v + 1}${v === next ? ' (next key replaces this)' : ''}">${noteName(n)}</span>`).join('');
    } else if (m === W_STRING || m === W_BAR) {
      const seq = w.seq[ch];
      seq.forEach((n) => lit.add(((n % 12) + 12) % 12));
      info = seq.map((n, j) => `<button type="button" class="chip seq" data-j="${j}" title="Step ${j + 1}: ${noteName(n + channelBase(ch))} (click to remove)">${noteName(n + channelBase(ch))}</button>`).join('');
    } else {
      info = `<span class="chip">bank ${['low', 'mid', 'high'][bank]}</span>`;
    }
    ui.keys.forEach((k, i) => k.classList.toggle('lit', lit.has(i)));
    ui.info.innerHTML = info;
    $$('.chip.seq', ui.info).forEach((c) => c.addEventListener('click', () => {
      const seq = w.seq[ch];
      if (seq.length > 1) { seq.splice(Number(c.dataset.j), 1); sendWingie(); }
    }));
  }
  renderEditor();
}

function renderEditor() {
  const body = $('#w-edit-body');
  if (!body || !$('.w-edit').open) return;
  const w = state.wingie;
  let html = '';
  for (const ch of [0, 1]) {
    const bank = w.oct[ch] + 1;
    html += `<fieldset><legend>${ch ? 'Right' : 'Left'} cave · ${['low', 'mid', 'high'][bank]} bank <small>(octave switch picks the bank)</small></legend><div class="edit-grid">`;
    for (let i = 0; i < 9; i++) {
      html += `<label><span>${i + 1}</span><input type="number" min="16" max="16000" step="0.01" data-cave="${ch},${bank},${i}" value="${w.cave[ch][bank][i]}"></label>`;
    }
    html += '</div></fieldset>';
  }
  html += '<fieldset><legend>Ratio profile <small>(voice 1 = 1–3, voice 2 = 4–6, voice 3 = 7–9)</small></legend><div class="edit-grid">';
  for (let i = 0; i < 9; i++) {
    html += `<label><span>${i + 1}</span><input type="number" min="0.125" max="32" step="0.001" data-ratio="${i}" value="${w.ratios[i]}"></label>`;
  }
  html += '</div><button type="button" class="btn small" id="ratio-reset">Factory ratios</button> <button type="button" class="btn small" id="ratio-copy">Copy voice 1 → 2 &amp; 3</button></fieldset>';
  if (body.dataset.html === html) return;
  body.innerHTML = html;
  body.dataset.html = html;
  $$('input[data-cave]', body).forEach((inp) => inp.addEventListener('change', () => {
    const [ch, bank, i] = inp.dataset.cave.split(',').map(Number);
    const v = Math.min(16000, Math.max(16, Number(inp.value) || 16));
    w.cave[ch][bank][i] = Math.round(v * 100) / 100;
    sendWingie();
  }));
  $$('input[data-ratio]', body).forEach((inp) => inp.addEventListener('change', () => {
    const v = Math.min(32, Math.max(0.125, Number(inp.value) || 1));
    w.ratios[Number(inp.dataset.ratio)] = Math.round(v * 1000) / 1000;
    sendWingie();
  }));
  $('#ratio-reset', body).addEventListener('click', () => { w.ratios = [1, 2, 3, 4, 5, 6, 7, 8, 9]; sendWingie(); });
  $('#ratio-copy', body).addEventListener('click', () => { const r = w.ratios; w.ratios = [r[0], r[1], r[2], r[0], r[1], r[2], r[0], r[1], r[2]]; sendWingie(); });
}

// ---------------------------------------------------------------------------
// presets
// ---------------------------------------------------------------------------
function fillPresetSelect(selected) {
  const sel = $('#preset');
  sel.innerHTML = '';
  const g1 = document.createElement('optgroup');
  g1.label = 'Factory';
  PRESETS.forEach((p, i) => { const o = new Option(p.name, `f:${i}`); g1.appendChild(o); });
  sel.appendChild(g1);
  if (userPresets.length) {
    const g2 = document.createElement('optgroup');
    g2.label = 'Saved';
    userPresets.forEach((p, i) => g2.appendChild(new Option(p.name, `u:${i}`)));
    sel.appendChild(g2);
  }
  const custom = new Option('— current —', 'cur');
  sel.appendChild(custom);
  sel.value = selected || 'cur';
}

function loadState(s, note) {
  state = sanitiseState(s);
  for (const [id, k] of Object.entries(knobs)) k.set(state.params[id]);
  for (const [id, t] of Object.entries(toggles)) t.setAttribute('aria-pressed', state.params[id] > 0.5 ? 'true' : 'false');
  for (const id of Object.keys(state.params)) for (const fn of listeners) fn(id, state.params[id]);
  patch.set(state.cables);
  pushAll();
  renderWingie();
  $('#preset-note').textContent = note || '';
  autosave();
}

function randomPatch() {
  const r = Math.random;
  const pick = (a) => a[Math.floor(r() * a.length)];
  const p = {
    'c.lock': 1, 'c.bpm': Math.round(96 + r() * 50), 'c.mode': pick([1, 2, 2, 0]), 'c.glide': r() < 0.3 ? r() * 0.5 : 0,
    'k.drum': r(), 'k.pitch': 0.2 + r() * 0.6, 'k.decay': 0.56 + r() * 0.3, 'k.range': 1 + r() * 2, 'k.noiseLvl': r() * 0.5,
    'k.qnt': r() < 0.4 ? 1 : 0,
    's.drive': r() * 0.4, 's.fold': r() < 0.3 ? r() * 0.4 : 0,
    'w.mix': 0.65 + r() * 0.3, 'w.decay': 0.3 + r() * 0.6, 'w.tuning': r() < 0.2 ? Math.floor(r() * 8) : -1,
    'f.hp': 0.05 + r() * 0.2, 'f.lp': 0.55 + r() * 0.35, 'f.lpRes': r() * 0.5,
    'x.type': Math.floor(r() * 4), 'x.amt': r() * 0.4,
    'd.sync': pick([2, 3, 3, 4, 6]), 'd.fb': 0.2 + r() * 0.45, 'd.mix': 0.1 + r() * 0.3, 'd.pp': r() < 0.6 ? 1 : 0,
    'r.size': 0.3 + r() * 0.6, 'r.mix': 0.1 + r() * 0.35,
    'g.root': Math.floor(r() * 12), 'g.scale': pick([0, 2, 3, 4, 5, 7, 8]),
  };
  // round 2 dial-ins
  p['k.wave'] = r() < 0.5 ? 0 : r();
  p['k.kit'] = r() < 0.5 ? 0 : Math.floor(r() * KITS.length);
  p['w.damp'] = r() < 0.5 ? 0 : r() * 0.6;
  p['w.stretch'] = r() < 0.6 ? 0 : (r() - 0.5) * 0.8;
  p['w.spread'] = r() * 0.5;
  p['f.env'] = r() < 0.5 ? 0 : r() * 0.6;
  p['f.envDec'] = 0.2 + r() * 0.5;
  p['l.shape'] = Math.floor(r() * 7);
  p['l.sync'] = pick([0, 3, 4, 5]);
  if (r() < 0.55) {
    Object.assign(p, {
      'o.wave': pick([0.667, 1, 0.5, 0.85, 0.33]), 'o.pw': 0.2 + r() * 0.6, 'o.sub': r() * 0.5, 'o.det': r() < 0.5 ? 0 : r() * 0.6,
      'o.oct': pick([-1, 0, 0, 1]), 'o.glide': r() < 0.3 ? r() * 0.4 : 0, 'o.dec': 0.25 + r() * 0.4,
      'o.lvlW': r() * 0.4, 'o.lvlD': 0.2 + r() * 0.4, 'o.src': pick([0, 0, 1, 2]),
    });
  }
  const scale = SCALES[p['g.scale']].steps;
  const seq = () => Array.from({ length: 3 + Math.floor(r() * 6) }, () => p['g.root'] + pick(scale) + (r() < 0.25 ? 12 : 0));
  const trigSrc = pick(['u.div2', 'u.div2', 'u.div4', 'u.div4', 'c.tri', 'u.div3']);
  if (trigSrc !== 'c.tri' && r() < 0.35) p['amt.k.trig'] = 0.6; // accents only
  const extras = [['c.step', 'w.noteL'], ['c.step', 'w.noteR'], ['c.step', 'k.pitch'], ['u.drift', 'f.lp'], ['k.env', 'f.lp'],
    ['u.drift', 'w.decay'], ['u.div3', 'w.adv'], ['c.tri', 's.fold'], ['w.trigR', 'k.drum'], ['c.step', 'k.drum'],
    ['l.out', 'k.wave'], ['l.out', 'o.pwm'], ['l.out', 'f.lp'], ['l.out', 'o.wave'], ['u.drift', 'w.decay']];
  const cables = [[trigSrc, 'k.trig']];
  for (let i = 0; i < 1 + Math.floor(r() * 3); i++) {
    const c = pick(extras);
    if (!cables.some((x) => x[1] === c[1])) cables.push(c);
  }
  if (cables.some((c) => c[1] === 'w.adv')) { p['w.threshL'] = 1; p['w.threshR'] = 1; }
  const modes = [pick([1, 1, 2, 0, 4]), pick([2, 1, 3, 2, 0])];
  const root = p['g.root'] + 48;
  return {
    params: Object.assign(fullDefaults(), p),
    cables,
    wingie: normaliseWingie({
      mode: modes, oct: [0, pick([-1, -1, 0])], seq: [seq(), seq()],
      poly: [[root, root + scale[2 % scale.length], root + 7], [root + 12, root + 12 + scale[1], root + 19]],
    }),
  };
}

// ---------------------------------------------------------------------------
// meters / visuals
// ---------------------------------------------------------------------------
const scope = $('#scope');
const sctx = scope.getContext('2d');
const resView = $('#res-view');
const rctx = resView.getContext('2d');
const scopeBuf = new Float32Array(2048);
let lastStepPos = -1;

function sizeCanvas(c) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
}

function drawScope() {
  sizeCanvas(scope);
  const w = scope.width, h = scope.height;
  sctx.clearRect(0, 0, w, h);
  sctx.strokeStyle = 'rgba(232,182,76,0.12)';
  sctx.beginPath(); sctx.moveTo(0, h / 2); sctx.lineTo(w, h / 2); sctx.stroke();
  if (!engine.analyser || !engine.running) return;
  engine.analyser.getFloatTimeDomainData(scopeBuf);
  let start = 0;
  for (let i = 1; i < 1024; i++) if (scopeBuf[i - 1] < 0 && scopeBuf[i] >= 0) { start = i; break; }
  sctx.strokeStyle = '#e8b64c';
  sctx.lineWidth = Math.max(1, w / 360);
  sctx.beginPath();
  const n = 1024;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * w;
    const y = h / 2 - scopeBuf[start + i] * h * 0.45;
    if (i) sctx.lineTo(x, y); else sctx.moveTo(x, y);
  }
  sctx.stroke();
}

function drawResonators(m) {
  sizeCanvas(resView);
  const w = resView.width, h = resView.height;
  const dpr = w / resView.clientWidth || 1;
  rctx.clearRect(0, 0, w, h);
  const lane = h / 2;
  const fx = (f) => (Math.log(f / 16) / Math.log(16000 / 16)) * (w - 16 * dpr) + 8 * dpr;
  rctx.font = `${10 * dpr}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  // octave grid
  rctx.strokeStyle = 'rgba(30,26,20,0.08)';
  for (let f = 32.7; f < 16000; f *= 2) { const x = fx(f); rctx.beginPath(); rctx.moveTo(x, 0); rctx.lineTo(x, h); rctx.stroke(); }
  rctx.fillStyle = 'rgba(30,26,20,0.07)';
  rctx.fillRect(0, lane - 0.5 * dpr, w, dpr);
  if (!m) return;
  const cols = ['#b5832a', '#2f8f86'];
  for (let ch = 0; ch < 2; ch++) {
    const y0 = ch ? h : lane;
    for (let i = 0; i < 9; i++) {
      const f = m.freqs[ch][i];
      const e = Math.min(1, Math.sqrt(m.energy[ch * 9 + i]) * 0.9);
      const x = fx(f);
      const bh = 4 * dpr + e * (lane - 16 * dpr);
      rctx.fillStyle = cols[ch];
      rctx.globalAlpha = 0.25 + e * 0.75;
      rctx.fillRect(x - 2 * dpr, y0 - bh - 2 * dpr, 4 * dpr, bh);
    }
    rctx.globalAlpha = 1;
    const note = m.notes[ch];
    rctx.fillStyle = 'rgba(30,26,20,0.55)';
    rctx.fillText(`${ch ? 'R' : 'L'} ${note >= 0 ? noteName(Math.round(note)) : 'cave'}`, 6 * dpr, (ch ? lane : 0) + 12 * dpr);
  }
}

// ---- waveform previews ----
const KASTLE_TABLES = (() => {
  const sine = [], tri = [], saw = [], sq = [];
  for (let i = 0; i < 256; i++) {
    sine.push(127.5 - 127.5 * Math.cos((Math.PI * 2 * i) / 256) * 1); // display only
    tri.push(i < 128 ? i * 2 : 255 - (i - 128) * 2);
    saw.push(i);
    sq.push(i < 128 ? 255 : 1);
  }
  // the firmware sine starts at its minimum, like this cosine
  return [sine, tri, saw, sq, ...Object.values(KASTLE_WAVES).map((t) => t.map((v) => v + 128))];
})();

function kastleWaveAt(pos, i) {
  const x = Math.max(0, Math.min(1, pos)) * (KASTLE_TABLES.length - 1);
  const k = Math.min(KASTLE_TABLES.length - 2, Math.floor(x));
  const f = x - k;
  return (KASTLE_TABLES[k][i] * (1 - f) + KASTLE_TABLES[k + 1][i] * f) / 127.5 - 1;
}

function voiceWaveAt(wave, pw, ph) {
  const shape = (k) => (k === 0 ? Math.sin(Math.PI * 2 * ph) : k === 1 ? (ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph) : k === 2 ? 2 * ph - 1 : ph < pw ? 1 : -1);
  const x = wave * 3, seg = x >= 3 ? 2 : Math.floor(x), f = x - seg;
  return shape(seg) * (1 - f) + shape(Math.min(3, seg + 1)) * f;
}

function drawWave(canvas, fn, color) {
  sizeCanvas(canvas);
  const c = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  c.clearRect(0, 0, w, h);
  c.strokeStyle = 'rgba(255,255,255,0.08)';
  c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke();
  c.strokeStyle = color;
  c.lineWidth = Math.max(1.5, w / 160);
  c.lineJoin = 'round';
  c.beginPath();
  const n = 256, pad = h * 0.14;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = h / 2 - fn(t) * (h / 2 - pad);
    const x = t * w;
    if (i) c.lineTo(x, y); else c.moveTo(x, y);
  }
  c.stroke();
}

function drawWavePreviews() {
  const P = state.params;
  drawWave($('#k-wave-view'), (t) => kastleWaveAt(P['k.wave'], Math.min(255, Math.floor(t * 2 * 256) % 256)), '#e8b64c');
  drawWave($('#v-wave-view'), (t) => {
    const ph = (t * 2) % 1;
    const dt = 0;
    let y = voiceWaveAt(P['o.wave'], P['o.pw'], ph);
    if (P['o.sub'] > 0.001) y += (t < 0.5 ? 1 : -1) * P['o.sub'];
    if (P['o.det'] > 0.001) y += voiceWaveAt(P['o.wave'], P['o.pw'], (ph * (1 + P['o.det'] * 0.06) + 0.37) % 1) * P['o.det'];
    return (y + dt) / (1 + P['o.det'] * 0.6 + P['o.sub'] * 0.6);
  }, '#c4d65a');
}

const stepCells = $('#step-cells');
for (let i = 0; i < 16; i++) { const c = document.createElement('i'); c.appendChild(document.createElement('b')); stepCells.appendChild(c); }

function lamp(el, on) { if (el) el.classList.toggle('on', !!on); }

function frame() {
  drawScope();
  const m = lastMeter;
  if (m && engine.running) {
    $('#k-env').style.transform = `scaleX(${m.env})`;
    $('#k-env2').style.transform = `scaleX(${m.env2})`;
    lamp($('#k-t0'), m.trigState === 0); lamp($('#k-t1'), m.trigState === 1); lamp($('#k-t2'), m.trigState === 2);
    $('#k-style').textContent = DRUM_STYLES[m.drum] || '';
    lamp($('#c-led'), m.clk);
    const d = m.div;
    lamp($('#d2'), m.clk && d % 2 === 0); lamp($('#d3'), m.clk && d % 3 === 0); lamp($('#d4'), m.clk && d % 4 === 0); lamp($('#d8'), m.clk && d % 8 === 0);
    if (m.pos !== lastStepPos) {
      lastStepPos = m.pos;
      $$('i', stepCells).forEach((c, i) => c.classList.toggle('on', i === m.pos));
    }
    $$('b', stepCells)[m.pos].style.transform = `scaleY(${Math.max(0.04, m.step)})`;
    for (const ch of [0, 1]) {
      const ui = wingieUI[ch];
      lamp(ui.trig, ch ? m.trigR : m.trigL);
      const idx = m.seqIdx[ch];
      $$('.chip.seq', ui.info).forEach((c, j) => c.classList.toggle('playing', j === idx));
    }
    const lfoLed = $('#lfo-led');
    lfoLed.style.opacity = String(0.25 + m.lfo * 0.75);
    lamp(lfoLed, m.lfo > 0.5);
    lamp($('#v-led'), m.venv > 0.05);
    const vOn = state.params['o.lvlW'] > 0 || state.params['o.lvlD'] > 0;
    if (vOn && m.vhz) {
      const midi = 69 + 12 * Math.log2(m.vhz / state.params['w.a3']);
      $('#voice-readout').textContent = `${noteName(Math.round(midi))} · ${m.vhz.toFixed(1)} Hz`;
    } else $('#voice-readout').textContent = vOn ? '' : 'off: raise To Wingie or Direct';
    $('#vu-l').style.transform = `scaleY(${Math.min(1, m.peak[0])})`;
    $('#vu-r').style.transform = `scaleY(${Math.min(1, m.peak[1])})`;
    lamp($('#lim'), m.limit);
    const ticks = [0, 1, 2, 3, 4, 6, 8, 12, 16][state.params['d.sync']];
    $('#echo-readout').textContent = ticks ? `echo ${Math.round((ticks / m.hz) * 1000)} ms` : '';
  }
  drawResonators(m && engine.running ? m : null);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// MIDI
// ---------------------------------------------------------------------------
let midiAlt = 0;
async function initMidi() {
  if (!navigator.requestMIDIAccess) return;
  try {
    const access = await navigator.requestMIDIAccess();
    const bind = () => { for (const input of access.inputs.values()) input.onmidimessage = onMidi; };
    bind();
    access.onstatechange = bind;
  } catch { /* permission denied or unavailable */ }
}

function onMidi(e) {
  const [st, d1, d2] = e.data;
  const type = st & 0xf0, chan = st & 0x0f;
  if (type === 0x90 && d2 > 0) {
    if (chan === 9) { engine.hit(d2 > 90); return; }
    let ch = chan === 0 ? 0 : chan === 1 ? 1 : chan === 2 ? (midiAlt ^= 1) : -1;
    if (ch < 0) return;
    const w = state.wingie, m = w.mode[ch];
    if (m === W_POLY || m === W_RATIO) {
      const notes = m === W_POLY ? w.poly : w.ratioNotes;
      const key = m === W_POLY ? 'polyNext' : 'ratioNext';
      notes[ch][w[key][ch]] = d1;
      w[key][ch] = (w[key][ch] + 1) % 3;
      sendWingie();
    } else if (m === W_STRING || m === W_BAR) {
      w.seq[ch] = [d1 - channelBase(ch)];
      sendWingie(ch ? [false, true] : [true, false]);
    }
  } else if (type === 0xb0) {
    const v = d2 / 127;
    if (d1 === 1) setParam('w.decay', v);
    else if (d1 === 7) setParam('w.vol', v);
    else if (d1 === 11) setParam('w.mix', v);
  }
}

// ---------------------------------------------------------------------------
// wiring
// ---------------------------------------------------------------------------
function init() {
  $$('[data-knob]').forEach((el) => { if (!el.closest('.jack-cell') && !el.closest('.w-side')) buildKnob(el); });
  $$('[data-toggle]').forEach(buildToggle);
  buildJacks();
  $$('.w-side').forEach((el) => buildWingieSide(el, Number(el.dataset.ch)));

  buildSeg($('#step-mode'), 'c.mode', STEP_MODES);
  buildSeg($('#color-type'), 'x.type', COLOR_TYPES);
  buildSelect($('#root'), 'g.root', NOTE_NAMES.map((n, i) => [i, n]));
  buildSelect($('#scale'), 'g.scale', SCALES.map((s, i) => [i, s.name]));
  buildSelect($('#tuning'), 'w.tuning', [[-1, 'Equal temperament'], ...ALT_TUNINGS.map((t, i) => [i, t.name])]);
  buildSelect($('#sync'), 'd.sync', SYNC_LABELS.map((l, i) => [i, i ? `${l} of the clock` : 'Free (Time knob)']));
  buildSelect($('#kit'), 'k.kit', KITS.map((k, i) => [i, k.name]));
  buildSelect($('#voice-src'), 'o.src', VOICE_SOURCES.map((n, i) => [i, n]));
  buildSelect($('#lfo-sync'), 'l.sync', LFO_SYNC.map((n, i) => [i, n]));
  buildSeg($('#lfo-shape'), 'l.shape', LFO_SHAPES);
  buildSeg($('#voice-trig'), 'o.trig', VOICE_TRIGS);

  // derived UI
  const bpm = $('#bpm');
  listeners.push((id, v) => {
    if (id === 'k.drum') $('#k-style').textContent = DRUM_STYLES[drumStyle(state.params['k.drum'])];
    if (id === 'c.bpm') bpm.value = String(Math.round(v));
    if (id === 'c.lock') document.body.classList.toggle('bpm-locked', v > 0.5);
    if (id === 'd.sync') document.body.classList.toggle('echo-synced', v > 0);
    if (id === 'g.root' || id === 'g.scale') renderWingie();
    if (id === 'l.sync') document.body.classList.toggle('lfo-synced', v > 0);
    if (id === 'k.wave' || id.startsWith('o.')) { cancelAnimationFrame(drawWavePreviews.raf); drawWavePreviews.raf = requestAnimationFrame(drawWavePreviews); }
  });
  for (const id of ['k.drum', 'c.bpm', 'c.lock', 'd.sync', 'l.sync', 'k.wave']) for (const fn of listeners) fn(id, state.params[id]);
  window.addEventListener('resize', () => drawWavePreviews());
  bpm.addEventListener('change', () => {
    const v = Math.min(300, Math.max(30, Math.round(Number(bpm.value) || 120)));
    setParam('c.bpm', v);
    if (state.params['c.lock'] < 0.5) setParam('c.lock', 1);
  });
  const taps = [];
  $('#tap').addEventListener('click', () => {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now);
    if (taps.length > 5) taps.shift();
    if (taps.length >= 2) {
      const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
      setParam('c.bpm', Math.min(300, Math.max(30, Math.round(60000 / avg))));
      setParam('c.lock', 1);
    }
  });

  $('#hit').addEventListener('pointerdown', () => engine.hit(true));
  $('#regen').addEventListener('click', () => engine.regenerate());
  $('#panic').addEventListener('click', () => engine.panic());
  $('.w-edit').addEventListener('toggle', () => { $('#w-edit-body').dataset.html = ''; renderEditor(); });

  // power
  const power = $('#power');
  power.addEventListener('click', async () => {
    try {
      if (engine.running) {
        await engine.suspend();
      } else {
        const first = !engine.ctx;
        await engine.start();
        if (first) { pushAll(); initMidi(); }
      }
    } catch (e) {
      toast(e.message);
      console.error(e);
    }
    const on = engine.running;
    power.setAttribute('aria-pressed', String(on));
    $('.power-txt', power).textContent = on ? 'Audio on' : 'Start audio';
    document.body.classList.toggle('live', on);
  });

  // presets
  fillPresetSelect();
  $('#preset').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v.startsWith('f:')) { const p = PRESETS[Number(v.slice(2))]; loadState(fromPreset(p), p.note); }
    else if (v.startsWith('u:')) { const p = userPresets[Number(v.slice(2))]; loadState(p.state, ''); }
  });
  $('#save').addEventListener('click', () => {
    const name = prompt('Name this patch', `Patch ${userPresets.length + 1}`);
    if (!name) return;
    const existing = userPresets.findIndex((p) => p.name === name);
    const entry = { name, state: clone(state) };
    if (existing >= 0) userPresets[existing] = entry; else userPresets.push(entry);
    store.set('hp.user', userPresets);
    fillPresetSelect(`u:${existing >= 0 ? existing : userPresets.length - 1}`);
    toast(`Saved “${name}” in this browser`);
  });
  $('#del').addEventListener('click', () => {
    const v = $('#preset').value;
    if (!v.startsWith('u:')) { toast('Only saved patches can be deleted'); return; }
    const i = Number(v.slice(2));
    if (!confirm(`Delete “${userPresets[i].name}”?`)) return;
    userPresets.splice(i, 1);
    store.set('hp.user', userPresets);
    fillPresetSelect();
  });
  $('#random').addEventListener('click', () => { loadState(randomPatch(), 'Randomised patch'); fillPresetSelect(); });
  $('#export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ app: 'harmonic-pulse', version: 1, ...state }, null, 2)], { type: 'application/json' });
    download(blob, 'harmonic-pulse-patch.json');
  });
  $('#import').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      loadState(data, `Imported ${f.name}`);
      fillPresetSelect();
    } catch {
      toast('That file is not a Harmonic Pulse patch');
    }
    e.target.value = '';
  });

  // recording
  const rec = $('#rec');
  rec.addEventListener('click', async () => {
    if (rec.getAttribute('aria-pressed') === 'true') {
      rec.setAttribute('aria-pressed', 'false');
      rec.textContent = '● Rec';
      const blob = await engine.stopRecording();
      if (blob) download(blob, `harmonic-pulse-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.wav`);
    } else {
      if (!engine.running) { toast('Start the audio first'); return; }
      engine.startRecording();
      rec.setAttribute('aria-pressed', 'true');
      rec.textContent = '■ Stop';
    }
  });

  $('#cables-toggle').addEventListener('click', (e) => {
    const on = rack.classList.toggle('cables-faded');
    e.currentTarget.setAttribute('aria-pressed', String(on));
  });
  $('#help-btn').addEventListener('click', (e) => {
    const h = $('#help');
    h.hidden = !h.hidden;
    e.currentTarget.setAttribute('aria-expanded', String(!h.hidden));
    patch.redraw();
  });

  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (e.code === 'Space' && !e.target.closest('button,[role=slider]')) { e.preventDefault(); engine.hit(true); }
  });

  patch.set(state.cables);
  pushAll();
  renderWingie();
  requestAnimationFrame(() => { patch.redraw(); drawWavePreviews(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => patch.redraw());
  requestAnimationFrame(frame);
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

init();
