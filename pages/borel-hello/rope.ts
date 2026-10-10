import type { PenPath } from './pen-geometry';

interface Node { x: number; y: number; px: number; py: number }
interface Link { a: number; b: number; length: number; stiffness: number }
interface Binding { a: number; b: number; t: number; x: number; y: number; dx: number; dy: number }

/** A rope lying on a flat floor: inextensible links, local bending resistance
 * and velocity friction. No gravity in the floor plane and no home springs. */
export class FloorRope {
  readonly nodes: Node[] = [];
  private links: Link[] = [];
  private bindings: Binding[][] = [];
  private grab: { index: number; x: number; y: number; offsetX: number; offsetY: number } | undefined;
  private accumulator = 0;
  awake = false;
  constructor(readonly pens: readonly PenPath[]) {
    const owners: number[] = [], endpoints: { node: number; owner: number }[] = [];
    for (const [owner, pen] of pens.entries()) {
      if (pen.retrace || !pen.points.length) { this.bindings.push([]); continue; }
      const samples = [0];
      let last = 0;
      for (let i = 1; i < pen.points.length - 1; i++) {
        if (pen.points[i].distance - pen.points[last].distance >= 20) { samples.push(i); last = i; }
      }
      if (pen.points.length > 1) samples.push(pen.points.length - 1);
      const previousNodeCount = this.nodes.length;
      const ids = samples.map((index, sampleIndex) => {
        const point = pen.points[index];
        // Only stroke endpoints may weld. Crossing unrelated interiors never
        // turns a loose crossing into a knot; spaces never get fake connectors.
        const match = sampleIndex === 0 || sampleIndex === samples.length - 1
          ? this.nodes.findIndex((n, i) => (i < previousNodeCount || pen.length > 40) && Math.hypot(n.x - point.x, n.y - point.y) < .001) : -1;
        if (match >= 0) return match;
        owners.push(owner);
        this.nodes.push({ x: point.x, y: point.y, px: point.x, py: point.y });
        return this.nodes.length - 1;
      });
      if (pen.length > 40) endpoints.push({ node: ids[0], owner }, { node: ids[ids.length - 1], owner });
      const link = (a: number, b: number, stiffness: number) => {
        if (a !== b) this.links.push({ a, b, length: Math.hypot(this.nodes[a].x - this.nodes[b].x, this.nodes[a].y - this.nodes[b].y), stiffness });
      };
      for (let i = 1; i < ids.length; i++) link(ids[i - 1], ids[i], 1);
      for (let i = 2; i < ids.length; i++) link(ids[i - 2], ids[i], .002);
      let segment = 0;
      this.bindings.push(pen.points.map(point => {
        while (segment < samples.length - 2 && pen.points[samples[segment + 1]].distance < point.distance) segment++;
        const ia = samples[segment], ib = samples[Math.min(segment + 1, samples.length - 1)];
        const a = pen.points[ia], b = pen.points[ib];
        const t = (point.distance - a.distance) / (b.distance - a.distance || 1);
        return { a: ids[segment], b: ids[Math.min(segment + 1, ids.length - 1)], t,
          dx: b.x - a.x, dy: b.y - a.y, x: point.x - a.x - (b.x - a.x) * t, y: point.y - a.y - (b.y - a.y) * t };
      }));
    }
    // A handoff can touch the interior of another authored stroke. Coarse
    // sampling must not detach it: a short rigid link preserves that contact
    // without shifting the original silhouette or joining whole interiors.
    for (const endpoint of endpoints) {
      const a = this.nodes[endpoint.node];
      let nearest = -1, distance = 24;
      for (const [i, b] of this.nodes.entries()) {
        if (i === endpoint.node || owners[i] === endpoint.owner) continue;
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        if (d < distance) { nearest = i; distance = d; }
      }
      if (nearest >= 0) this.links.push({ a: endpoint.node, b: nearest, length: distance, stiffness: 1 });
    }
  }
  pick(x: number, y: number, reach: number): boolean {
    let distance = reach, index = -1;
    for (const [i, node] of this.nodes.entries()) {
      const d = Math.hypot(node.x - x, node.y - y);
      if (d < distance) { distance = d; index = i; }
    }
    if (index < 0) return false;
    this.grab = { index, x: this.nodes[index].x, y: this.nodes[index].y, offsetX: x - this.nodes[index].x, offsetY: y - this.nodes[index].y };
    this.awake = true;
    return true;
  }
  move(x: number, y: number) { if (this.grab) { this.grab.x = x - this.grab.offsetX; this.grab.y = y - this.grab.offsetY; this.awake = true; } }
  release() { this.grab = undefined; }
  step(seconds: number) {
    if (!this.awake) return;
    this.accumulator += Math.min(.05, Math.max(0, seconds));
    while (this.accumulator >= 1 / 120) { this.solve(); this.accumulator -= 1 / 120; }
  }
  private solve() {
    for (const n of this.nodes) {
      const vx = (n.x - n.px) * .86, vy = (n.y - n.py) * .86;
      n.px = n.x; n.py = n.y; n.x += vx; n.y += vy;
    }
    const grab = this.grab;
    // Limit a pointer jump per physics step, keeping constraints stable even
    // with event coalescing or a fast touch swipe.
    const held = grab && this.nodes[grab.index];
    const distance = held && grab ? Math.hypot(grab.x - held.x, grab.y - held.y) : 0;
    const targetX = held && grab ? held.x + (grab.x - held.x) * Math.min(1, 120 / (distance || 1)) : 0;
    const targetY = held && grab ? held.y + (grab.y - held.y) * Math.min(1, 120 / (distance || 1)) : 0;
    for (let iteration = 0; iteration < 32; iteration++) {
      for (const link of this.links) {
        const a = this.nodes[link.a], b = this.nodes[link.b];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d < 1e-8) continue;
        const aHeld = grab?.index === link.a, bHeld = grab?.index === link.b;
        const correction = (d - link.length) / d * link.stiffness / (aHeld || bHeld ? 1 : 2);
        if (!aHeld) { a.x += dx * correction; a.y += dy * correction; }
        if (!bHeld) { b.x -= dx * correction; b.y -= dy * correction; }
      }
      if (held) { held.x = targetX; held.y = targetY; }
    }
    if (held) { held.px = held.x; held.py = held.y; }
    let speed = 0;
    for (const n of this.nodes) speed = Math.max(speed, Math.hypot(n.x - n.px, n.y - n.py));
    this.awake = Boolean(grab) || speed > .015;
    if (!this.awake) for (const n of this.nodes) { n.px = n.x; n.py = n.y; }
  }
  deformed(index: number): PenPath {
    const pen = this.pens[index], bindings = this.bindings[index];
    return { ...pen, points: pen.points.map((p, i) => {
      const bind = bindings[i];
      if (!bind) return p;
      const a = this.nodes[bind.a], b = this.nodes[bind.b];
      const angle = Math.atan2(b.y - a.y, b.x - a.x) - Math.atan2(bind.dy, bind.dx);
      const c = Math.cos(angle), s = Math.sin(angle);
      return { ...p, x: a.x + (b.x - a.x) * bind.t + bind.x * c - bind.y * s, y: a.y + (b.y - a.y) * bind.t + bind.x * s + bind.y * c };
    }) };
  }
}
