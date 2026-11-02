// Rotary knob: drag vertically (Shift = fine), wheel, arrow keys, double-click to reset.

const SVG_NS = 'http://www.w3.org/2000/svg';
const A0 = -135, A1 = 135;

function polar(cx, cy, r, deg) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
function arc(cx, cy, r, from, to) {
  if (Math.abs(to - from) < 0.01) return '';
  const [x0, y0] = polar(cx, cy, r, from);
  const [x1, y1] = polar(cx, cy, r, to);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  const sweep = to > from ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export class Knob {
  constructor(el, opts) {
    this.el = el;
    this.min = opts.min ?? 0;
    this.max = opts.max ?? 1;
    this.step = opts.step || 0;
    this.def = opts.def ?? this.min;
    this.bipolar = !!opts.bipolar;
    this.fmt = opts.fmt || ((v) => v.toFixed(2));
    this.onChange = opts.onChange || (() => {});
    this.value = opts.value ?? this.def;
    const size = opts.size || 'md';

    el.classList.add('knob', `knob-${size}`);
    el.innerHTML = '';
    const dial = document.createElement('div');
    dial.className = 'knob-dial';
    dial.tabIndex = 0;
    dial.setAttribute('role', 'slider');
    dial.setAttribute('aria-label', opts.label || '');
    dial.setAttribute('aria-valuemin', String(this.min));
    dial.setAttribute('aria-valuemax', String(this.max));
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 48 48');
    svg.innerHTML = `
      <path class="knob-track" d="${arc(24, 24, 20, A0, A1)}"/>
      <path class="knob-val"/>
      <circle class="knob-cap" cx="24" cy="24" r="14.5"/>
      <line class="knob-ptr" x1="24" y1="24" x2="24" y2="11.5"/>`;
    dial.appendChild(svg);
    el.appendChild(dial);
    if (opts.label) {
      const lab = document.createElement('span');
      lab.className = 'knob-label';
      lab.textContent = opts.label;
      el.appendChild(lab);
    }
    const out = document.createElement('output');
    out.className = 'knob-out';
    el.appendChild(out);
    if (opts.title) el.title = opts.title;
    this.dial = dial; this.valPath = svg.querySelector('.knob-val'); this.ptr = svg.querySelector('.knob-ptr'); this.out = out;

    dial.addEventListener('pointerdown', (e) => this.down(e));
    dial.addEventListener('dblclick', () => this.set(this.def, true));
    dial.addEventListener('wheel', (e) => {
      e.preventDefault();
      const n = this.norm(this.value) - Math.sign(e.deltaY) * (e.shiftKey ? 0.004 : 0.02);
      this.set(this.denorm(n), true);
    }, { passive: false });
    dial.addEventListener('keydown', (e) => {
      const big = e.shiftKey ? 0.1 : 0.02;
      let n = this.norm(this.value);
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') n += big;
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') n -= big;
      else if (e.key === 'PageUp') n += 0.1;
      else if (e.key === 'PageDown') n -= 0.1;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = 1;
      else return;
      e.preventDefault();
      this.set(this.denorm(n), true);
    });
    this.render();
  }

  norm(v) { return (v - this.min) / (this.max - this.min); }
  denorm(n) {
    let v = this.min + Math.max(0, Math.min(1, n)) * (this.max - this.min);
    if (this.step) v = Math.round(v / this.step) * this.step;
    return v;
  }

  down(e) {
    e.preventDefault();
    this.dial.focus();
    this.dial.setPointerCapture(e.pointerId);
    let lastY = e.clientY;
    let n = this.norm(this.value);
    this.el.classList.add('active');
    const move = (ev) => {
      const dy = lastY - ev.clientY;
      lastY = ev.clientY;
      n = Math.max(0, Math.min(1, n + dy / (ev.shiftKey ? 900 : 180)));
      this.set(this.denorm(n), true);
    };
    const up = () => {
      this.el.classList.remove('active');
      this.dial.removeEventListener('pointermove', move);
      this.dial.removeEventListener('pointerup', up);
      this.dial.removeEventListener('pointercancel', up);
    };
    this.dial.addEventListener('pointermove', move);
    this.dial.addEventListener('pointerup', up);
    this.dial.addEventListener('pointercancel', up);
  }

  set(v, emit) {
    v = Math.max(this.min, Math.min(this.max, v));
    if (v === this.value && !emit) { this.render(); return; }
    const changed = v !== this.value;
    this.value = v;
    this.render();
    if (emit && changed) this.onChange(v);
  }

  render() {
    const n = this.norm(this.value);
    const ang = A0 + n * (A1 - A0);
    const from = this.bipolar ? 0 : A0;
    this.valPath.setAttribute('d', from <= ang ? arc(24, 24, 20, from, ang) : arc(24, 24, 20, ang, from));
    this.ptr.setAttribute('transform', `rotate(${ang.toFixed(1)} 24 24)`);
    const txt = this.fmt(this.value);
    this.out.textContent = txt;
    this.dial.setAttribute('aria-valuenow', String(this.value));
    this.dial.setAttribute('aria-valuetext', txt);
  }
}
