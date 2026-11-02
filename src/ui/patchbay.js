// Patch cables between jacks. Drag from a jack to another jack, or click one
// jack then the other. Alt-click a cable, or double-click a jack, to unplug.

import { CABLE_COLORS } from '../patch-def.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export class PatchBay {
  constructor(rack, svg, { onChange, onArm } = {}) {
    this.rack = rack;
    this.svg = svg;
    this.onChange = onChange || (() => {});
    this.onArm = onArm || (() => {});
    this.jacks = new Map(); // port -> { el, dir }
    this.cables = []; // { from, to, color, path, hit }
    this.armed = null;
    this.drag = null;
    this.colorIdx = 0;
    this.temp = document.createElementNS(SVG_NS, 'path');
    this.temp.setAttribute('class', 'cable temp');
    this.svg.appendChild(this.temp);

    new ResizeObserver(() => this.redraw()).observe(rack);
    window.addEventListener('resize', () => this.redraw());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.disarm();
      if (e.key === 'Alt') rack.classList.add('cable-edit');
    });
    document.addEventListener('keyup', (e) => { if (e.key === 'Alt') rack.classList.remove('cable-edit'); });
    window.addEventListener('blur', () => rack.classList.remove('cable-edit'));
  }

  registerJack(el, port, dir) {
    this.jacks.set(port, { el, dir });
    el.dataset.port = port;
    el.dataset.dir = dir;
    el.addEventListener('pointerdown', (e) => this.down(e, port));
    el.addEventListener('dblclick', (e) => { e.preventDefault(); this.unplugPort(port); });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); this.unplugPort(port); });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.clickJack(port); }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.unplugPort(port); }
    });
  }

  center(port) {
    const j = this.jacks.get(port);
    if (!j) return null;
    const r = j.el.getBoundingClientRect();
    const rr = this.rack.getBoundingClientRect();
    if (r.width === 0) return null;
    return [r.left + r.width / 2 - rr.left, r.top + r.height / 2 - rr.top];
  }

  static pathD(a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const dist = Math.hypot(dx, dy);
    const sag = Math.min(160, 24 + dist * 0.28);
    return `M${a[0].toFixed(1)} ${a[1].toFixed(1)}C${(a[0] + dx * 0.15).toFixed(1)} ${(a[1] + sag).toFixed(1)} ${(b[0] - dx * 0.15).toFixed(1)} ${(b[1] + sag).toFixed(1)} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
  }

  compatible(a, b) {
    if (!a || !b || a === b) return false;
    const ja = this.jacks.get(a), jb = this.jacks.get(b);
    return !!ja && !!jb && ja.dir !== jb.dir;
  }

  down(e, port) {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = [e.clientX, e.clientY];
    const el = this.jacks.get(port).el;
    el.setPointerCapture(e.pointerId);
    this.drag = { port, moved: false, over: null };
    const move = (ev) => {
      if (!this.drag) return;
      if (Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) > 6) this.drag.moved = true;
      if (!this.drag.moved) return;
      const rr = this.rack.getBoundingClientRect();
      const a = this.center(port);
      const b = [ev.clientX - rr.left, ev.clientY - rr.top];
      this.temp.setAttribute('d', PatchBay.pathD(a, b));
      this.temp.style.stroke = CABLE_COLORS[this.colorIdx % CABLE_COLORS.length];
      const target = document.elementFromPoint(ev.clientX, ev.clientY);
      const jackEl = target && target.closest && target.closest('.jack');
      const over = jackEl ? jackEl.dataset.port : null;
      this.highlight(this.compatible(port, over) ? over : null);
      this.drag.over = over;
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      const d = this.drag;
      this.drag = null;
      this.temp.setAttribute('d', '');
      this.highlight(null);
      if (!d) return;
      if (d.moved) {
        if (this.compatible(d.port, d.over)) this.connect(d.port, d.over);
        this.disarm();
      } else {
        this.clickJack(port);
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  clickJack(port) {
    if (this.armed && this.compatible(this.armed, port)) {
      this.connect(this.armed, port);
      this.disarm();
    } else if (this.armed === port) {
      this.disarm();
    } else {
      this.arm(port);
    }
  }

  arm(port) {
    this.disarm();
    this.armed = port;
    this.jacks.get(port).el.classList.add('armed');
    for (const [p, j] of this.jacks) j.el.classList.toggle('candidate', this.compatible(port, p));
    this.rack.classList.add('patching');
    this.onArm(port);
  }

  disarm() {
    if (this.armed && this.jacks.get(this.armed)) this.jacks.get(this.armed).el.classList.remove('armed');
    this.armed = null;
    for (const j of this.jacks.values()) j.el.classList.remove('candidate');
    this.rack.classList.remove('patching');
    this.onArm(null);
  }

  highlight(port) {
    for (const [p, j] of this.jacks) j.el.classList.toggle('hover', p === port);
  }

  connect(a, b, color, silent) {
    const fromOut = this.jacks.get(a).dir === 'out';
    const from = fromOut ? a : b, to = fromOut ? b : a;
    if (this.cables.some((c) => c.from === from && c.to === to)) return;
    const col = color || CABLE_COLORS[this.colorIdx++ % CABLE_COLORS.length];
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'cable-g');
    const shadow = document.createElementNS(SVG_NS, 'path');
    shadow.setAttribute('class', 'cable-shadow');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', 'cable');
    path.style.stroke = col;
    const hit = document.createElementNS(SVG_NS, 'path');
    hit.setAttribute('class', 'cable-hit');
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = `${from} → ${to} (Alt-click to unplug)`;
    hit.appendChild(title);
    g.append(shadow, path, hit);
    this.svg.insertBefore(g, this.temp);
    const cable = { from, to, color: col, g, path, shadow, hit };
    hit.addEventListener('click', (e) => { if (e.altKey) this.disconnect(cable); });
    this.cables.push(cable);
    this.updateJackState();
    this.redrawCable(cable);
    if (!silent) this.onChange(this.list());
  }

  disconnect(cable, silent) {
    const i = this.cables.indexOf(cable);
    if (i < 0) return;
    this.cables.splice(i, 1);
    cable.g.remove();
    this.updateJackState();
    if (!silent) this.onChange(this.list());
  }

  unplugPort(port) {
    const list = this.cables.filter((c) => c.from === port || c.to === port);
    for (const c of list) this.disconnect(c, true);
    if (list.length) this.onChange(this.list());
  }

  clear(silent) {
    for (const c of [...this.cables]) this.disconnect(c, true);
    if (!silent) this.onChange(this.list());
  }

  set(list) {
    this.clear(true);
    this.colorIdx = 0;
    for (const [a, b] of list) if (this.compatible(a, b)) this.connect(a, b, null, true);
    this.onChange(this.list());
  }

  list() { return this.cables.map((c) => [c.from, c.to]); }

  updateJackState() {
    const used = new Map();
    for (const c of this.cables) { used.set(c.from, c.color); used.set(c.to, c.color); }
    for (const [p, j] of this.jacks) {
      j.el.classList.toggle('plugged', used.has(p));
      j.el.style.setProperty('--plug', used.get(p) || 'transparent');
    }
  }

  redrawCable(c) {
    const a = this.center(c.from), b = this.center(c.to);
    if (!a || !b) { c.g.style.display = 'none'; return; }
    c.g.style.display = '';
    const d = PatchBay.pathD(a, b);
    c.path.setAttribute('d', d);
    c.shadow.setAttribute('d', d);
    c.hit.setAttribute('d', d);
  }

  redraw() {
    const rr = this.rack.getBoundingClientRect();
    this.svg.setAttribute('width', rr.width);
    this.svg.setAttribute('height', rr.height);
    this.svg.setAttribute('viewBox', `0 0 ${rr.width} ${rr.height}`);
    for (const c of this.cables) this.redrawCable(c);
  }
}
