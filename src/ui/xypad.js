// X/Y performance pad. x and y are 0..1 with y = 1 at the top.
// Pointer: press to gate, drag to move. Keyboard: arrows move (Shift = fine),
// Space or Enter holds the gate, Home centres.

const TRAIL = 48;

export class XYPad {
  constructor(el, canvas, { onMove, onGate, onRelease, getLabels } = {}) {
    this.el = el;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onMove = onMove || (() => {});
    this.onGate = onGate || (() => {});
    this.onRelease = onRelease || (() => {});
    this.getLabels = getLabels || (() => ['', '']);
    this.x = 0.5; this.y = 0.5;
    this.down = false;
    this.trail = [];
    this.raf = 0;
    this.anim = null;

    el.addEventListener('pointerdown', (e) => this.pointerDown(e));
    el.addEventListener('keydown', (e) => this.keyDown(e));
    el.addEventListener('keyup', (e) => {
      if ((e.key === ' ' || e.key === 'Enter') && this.down) { e.preventDefault(); this.release(); }
    });
    new ResizeObserver(() => this.draw()).observe(el);
  }

  set(x, y, emit) {
    this.x = Math.max(0, Math.min(1, x));
    this.y = Math.max(0, Math.min(1, y));
    this.trail.push([this.x, this.y, performance.now()]);
    if (this.trail.length > TRAIL) this.trail.shift();
    if (emit) this.onMove(this.x, this.y);
    this.schedule();
  }

  fromEvent(e) {
    const r = this.el.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height];
  }

  pointerDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    this.el.focus();
    this.el.setPointerCapture(e.pointerId);
    this.cancelAnim();
    this.press();
    const [x, y] = this.fromEvent(e);
    this.set(x, y, true);
    const move = (ev) => { const [mx, my] = this.fromEvent(ev); this.set(mx, my, true); };
    const up = () => {
      this.el.removeEventListener('pointermove', move);
      this.el.removeEventListener('pointerup', up);
      this.el.removeEventListener('pointercancel', up);
      this.release();
    };
    this.el.addEventListener('pointermove', move);
    this.el.addEventListener('pointerup', up);
    this.el.addEventListener('pointercancel', up);
  }

  press() {
    if (this.down) return;
    this.down = true;
    this.startPos = [this.x, this.y];
    this.el.classList.add('active');
    this.onGate(true);
  }

  release() {
    if (!this.down) return;
    this.down = false;
    this.el.classList.remove('active');
    this.onGate(false);
    this.onRelease(this.startPos);
    this.schedule();
  }

  keyDown(e) {
    const step = e.shiftKey ? 0.01 : 0.05;
    let { x, y } = this;
    switch (e.key) {
      case 'ArrowLeft': x -= step; break;
      case 'ArrowRight': x += step; break;
      case 'ArrowUp': y += step; break;
      case 'ArrowDown': y -= step; break;
      case 'Home': x = 0.5; y = 0.5; break;
      case ' ': case 'Enter':
        e.preventDefault();
        if (!e.repeat) { this.cancelAnim(); this.press(); }
        return;
      default: return;
    }
    e.preventDefault();
    this.cancelAnim();
    this.set(x, y, true);
  }

  // Glide the puck to (x, y) over ms, emitting moves along the way.
  glideTo(x, y, ms = 280) {
    this.cancelAnim();
    const x0 = this.x, y0 = this.y, t0 = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      const k = 1 - Math.pow(1 - t, 3);
      this.set(x0 + (x - x0) * k, y0 + (y - y0) * k, true);
      this.anim = t < 1 ? requestAnimationFrame(tick) : null;
    };
    this.anim = requestAnimationFrame(tick);
  }

  cancelAnim() { if (this.anim) { cancelAnimationFrame(this.anim); this.anim = null; } }

  schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  draw() {
    const c = this.canvas, ctx = this.ctx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    ctx.clearRect(0, 0, w, h);
    // grid
    ctx.strokeStyle = 'rgba(255, 143, 177, 0.08)';
    ctx.lineWidth = dpr;
    for (let i = 1; i < 8; i++) {
      const gx = (i / 8) * w, gy = (i / 8) * h;
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
    }
    // axis labels
    const [lx, ly] = this.getLabels();
    ctx.fillStyle = 'rgba(255, 200, 215, 0.45)';
    ctx.font = `${10 * dpr}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textAlign = 'right';
    ctx.fillText(`${lx} →`, w - 8 * dpr, h - 8 * dpr);
    ctx.save();
    ctx.translate(12 * dpr, 8 * dpr);
    ctx.rotate(Math.PI / 2);
    ctx.textAlign = 'left';
    ctx.fillText(`← ${ly}`, 0, 0);
    ctx.restore();
    // crosshair
    const px = this.x * w, py = (1 - this.y) * h;
    ctx.strokeStyle = 'rgba(255, 143, 177, 0.28)';
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
    // trail
    const now = performance.now();
    let alive = false;
    for (let i = 1; i < this.trail.length; i++) {
      const [ax, ay, at] = this.trail[i - 1];
      const [bx, by] = this.trail[i];
      const age = (now - at) / 900;
      if (age >= 1) continue;
      alive = true;
      ctx.strokeStyle = `rgba(255, 143, 177, ${(1 - age) * 0.6})`;
      ctx.lineWidth = (1 - age) * 5 * dpr + dpr;
      ctx.beginPath(); ctx.moveTo(ax * w, (1 - ay) * h); ctx.lineTo(bx * w, (1 - by) * h); ctx.stroke();
    }
    // puck
    const r = (this.down ? 13 : 10) * dpr;
    const g = ctx.createRadialGradient(px, py, 0, px, py, r * 2.4);
    g.addColorStop(0, this.down ? 'rgba(255, 143, 177, 0.55)' : 'rgba(255, 143, 177, 0.3)');
    g.addColorStop(1, 'rgba(255, 143, 177, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(px, py, r * 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = this.down ? '#ffc2d4' : '#ff8fb1';
    ctx.beginPath(); ctx.arc(px, py, r * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ff8fb1';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.stroke();
    if (alive || this.down) this.schedule();
  }
}
