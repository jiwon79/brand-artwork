export const config = {
  gravity: 1.2,
  damping: 0.978,
  iterations: 25,
  sweepRadius: 90,
  sweepStrength: 1.4,
  stiffness: 0.5,
  lockLength: false,
  uniform: false,
  blueprint: false,
};

export interface Bounds {
  width: number;
  height: number;
}

export class Point {
  x: number;
  y: number;
  ox: number;
  oy: number;
  pinned: boolean;

  constructor(x: number, y: number, pinned = false) {
    this.x = x;
    this.y = y;
    this.ox = x;
    this.oy = y;
    this.pinned = pinned;
  }

  update(halfW: number, bounds: Bounds) {
    if (this.pinned) return;

    const vx = (this.x - this.ox) * config.damping;
    const vy = (this.y - this.oy) * config.damping;
    this.ox = this.x;
    this.oy = this.y;
    this.x += vx;
    this.y += vy + config.gravity;

    if (this.x < halfW) {
      this.x = halfW;
      this.ox = this.x + (this.x - this.ox) * 0.3;
    }
    if (this.x > bounds.width - halfW) {
      this.x = bounds.width - halfW;
      this.ox = this.x + (this.x - this.ox) * 0.3;
    }
    if (this.y > bounds.height - halfW) {
      this.y = bounds.height - halfW;
      this.oy = this.y + (this.y - this.oy) * 0.3;
    }
  }

  sweep(mx: number, my: number, dvx: number, dvy: number) {
    if (this.pinned) return;
    const dx = this.x - mx;
    const dy = this.y - my;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > config.sweepRadius) return;

    const falloff = 1 - dist / config.sweepRadius;
    const smooth = falloff * falloff;
    this.ox -= dvx * smooth * config.sweepStrength;
    this.oy -= dvy * smooth * config.sweepStrength;
  }
}

export class Stick {
  a: Point;
  b: Point;
  len: number;

  constructor(a: Point, b: Point) {
    this.a = a;
    this.b = b;
    this.len = Math.hypot(b.x - a.x, b.y - a.y);
  }

  resolve() {
    const dx = this.b.x - this.a.x;
    const dy = this.b.y - this.a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
    const diff = ((dist - this.len) / dist) * config.stiffness;
    const ox = dx * diff;
    const oy = dy * diff;
    if (!this.a.pinned) {
      this.a.x += ox;
      this.a.y += oy;
    }
    if (!this.b.pinned) {
      this.b.x -= ox;
      this.b.y -= oy;
    }
  }
}

export class Rope {
  points: Point[] = [];
  sticks: Stick[] = [];
  lineWidth: number;
  halfW: number;

  constructor(pinX: number, pinY: number, length: number, segments: number, lineWidth: number) {
    this.lineWidth = lineWidth;
    this.halfW = lineWidth / 2;

    const segLen = length / segments;
    for (let i = 0; i <= segments; i++) {
      this.points.push(new Point(pinX, pinY + i * segLen, i === 0));
    }
    for (let i = 0; i < this.points.length - 1; i++) {
      this.sticks.push(new Stick(this.points[i], this.points[i + 1]));
    }
  }

  applySweep(mx: number, my: number, dvx: number, dvy: number) {
    for (const p of this.points) p.sweep(mx, my, dvx, dvy);
  }

  update(bounds: Bounds) {
    for (const p of this.points) p.update(this.halfW, bounds);

    for (let iter = 0; iter < config.iterations; iter++) {
      for (const s of this.sticks) s.resolve();
      for (const p of this.points) {
        if (p.pinned) continue;
        if (p.x < this.halfW) p.x = this.halfW;
        if (p.x > bounds.width - this.halfW) p.x = bounds.width - this.halfW;
        if (p.y > bounds.height - this.halfW) p.y = bounds.height - this.halfW;
      }
      this.points[0].x = this.points[0].ox;
      this.points[0].y = this.points[0].oy;
    }

    if (config.lockLength) {
      for (const s of this.sticks) {
        const dx = s.b.x - s.a.x;
        const dy = s.b.y - s.a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
        const nx = dx / dist;
        const ny = dy / dist;
        s.b.x = s.a.x + nx * s.len;
        s.b.y = s.a.y + ny * s.len;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const pts = this.points;
    if (pts.length < 2) return;

    if (config.blueprint) {
      this.drawBlueprint(ctx);
    } else {
      this.drawDefault(ctx);
    }
  }

  private drawDefault(ctx: CanvasRenderingContext2D) {
    const pts = this.points;

    let topY = pts[0].y;
    let botY = pts[0].y;
    for (const p of pts) {
      if (p.y < topY) topY = p.y;
      if (p.y > botY) botY = p.y;
    }
    const pinX = pts[0].x;
    const endX = pts[pts.length - 1].x;

    const grad = ctx.createLinearGradient(pinX, topY, endX, botY);
    grad.addColorStop(0.0, '#1a0800');
    grad.addColorStop(0.25, '#7a2800');
    grad.addColorStop(0.55, '#d06010');
    grad.addColorStop(0.8, '#f0a030');
    grad.addColorStop(1.0, '#ffe8a0');

    ctx.save();
    ctx.strokeStyle = grad;
    ctx.lineWidth = this.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawBlueprint(ctx: CanvasRenderingContext2D) {
    const pts = this.points;

    ctx.save();

    // sticks
    ctx.strokeStyle = 'rgba(80,160,255,0.35)';
    ctx.lineWidth = 1;
    for (const s of this.sticks) {
      ctx.beginPath();
      ctx.moveTo(s.a.x, s.a.y);
      ctx.lineTo(s.b.x, s.b.y);
      ctx.stroke();
    }

    // points
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const r = p.pinned ? 2 : 1.25;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      if (p.pinned) {
        ctx.fillStyle = 'rgba(255,100,80,0.9)';
      } else {
        ctx.fillStyle = 'rgba(120,200,255,0.8)';
      }
      ctx.fill();
    }

    ctx.restore();
  }
}
