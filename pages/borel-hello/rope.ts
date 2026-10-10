import type { PenPath } from './pen-geometry';
import { ropeCurve, ropeTangents, sampleRopePen, type RopeKnot, type RopePosition } from './rope-curve';

interface Node { x: number; y: number; px: number; py: number }
interface Link { a: number; b: number; length: number; stiffness: number; middle?: number }

/** A rope lying on a flat floor: inextensible links, local bending resistance
 * and velocity friction. No gravity in the floor plane and no home springs. */
export class FloorRope {
  readonly nodes: Node[] = [];
  private links: Link[] = [];
  private knots: RopeKnot[][] = [];
  private restNodes: RopePosition[] = [];
  private display: RopePosition[] | undefined;
  private neighbors = new Map<number, Set<number>>();
  private grab: { index: number; x: number; y: number; offsetX: number; offsetY: number } | undefined;
  private accumulator = 0;
  awake = false;
  constructor(readonly pens: readonly PenPath[]) {
    const owners: number[] = [], endpoints: { node: number; owner: number }[] = [];
    for (const [owner, pen] of pens.entries()) {
      if (pen.retrace || !pen.points.length) { this.knots.push([]); continue; }
      const count = Math.max(1, Math.ceil(pen.length / 20));
      const samples = Array.from({ length: count + 1 }, (_, i) => sampleRopePen(pen, pen.length * i / count));
      const previousNodeCount = this.nodes.length;
      const ids = samples.map((point, sampleIndex) => {
        // Only stroke endpoints may weld. Crossing unrelated interiors never
        // turns a loose crossing into a knot; spaces never get fake connectors.
        const match = sampleIndex === 0 || sampleIndex === samples.length - 1
          ? this.nodes.findIndex((n, i) => (i < previousNodeCount || pen.length > 40) && Math.hypot(n.x - point.x, n.y - point.y) < .001) : -1;
        if (match >= 0) return match;
        owners.push(owner);
        this.restNodes.push({ x: point.x, y: point.y });
        this.nodes.push({ x: point.x, y: point.y, px: point.x, py: point.y });
        return this.nodes.length - 1;
      });
      if (pen.length > 40) endpoints.push({ node: ids[0], owner }, { node: ids[ids.length - 1], owner });
      for (let i = 1; i < ids.length; i++) {
        const a = this.nodes[ids[i - 1]], b = this.nodes[ids[i]];
        this.links.push({ a: ids[i - 1], b: ids[i], length: Math.hypot(b.x - a.x, b.y - a.y), stiffness: 1 });
        const connect = (a: number, b: number) => {
          if (!this.neighbors.has(a)) this.neighbors.set(a, new Set());
          this.neighbors.get(a)!.add(b);
        };
        connect(ids[i - 1], ids[i]); connect(ids[i], ids[i - 1]);
      }
      this.knots.push(samples.map((rest, i) => ({ node: ids[i], distance: rest.distance, rest })));
    }
    // Build bends from material connectivity, including authored stroke
    // handoffs. Splitting an SVG path does not create a hinge in the rope.
    for (const [middle, adjacent] of this.neighbors) {
      if (adjacent.size !== 2) continue;
      const [a, b] = [...adjacent];
      this.links.push({ a, b, middle, length: 0, stiffness: .5 });
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
      if (nearest >= 0 && !this.neighbors.get(endpoint.node)?.has(nearest)) this.links.push({ a: endpoint.node, b: nearest, length: distance, stiffness: 1 });
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
    this.display = undefined;
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
        if (link.middle !== undefined) {
          const middle = this.nodes[link.middle];
          if (grab?.index !== link.middle && grab?.index !== link.a && grab?.index !== link.b &&
            Math.max(Math.hypot(a.x - a.px, a.y - a.py), Math.hypot(b.x - b.px, b.y - b.py), Math.hypot(middle.x - middle.px, middle.y - middle.py)) < .04) continue;
          const dx = b.x - a.x, dy = b.y - a.y, square = dx * dx + dy * dy;
          if (square < 1e-8) continue;
          const projection = ((middle.x - a.x) * dx + (middle.y - a.y) * dy) / square;
          const x = (middle.x - a.x - projection * dx) * link.stiffness;
          const y = (middle.y - a.y - projection * dy) * link.stiffness;
          // Project transverse curvature directly. A two-hop distance energy
          // has a vanishing gradient near straightness and leaves tiny waves.
          const middleHeld = grab?.index === link.middle;
          if (!middleHeld) { middle.x -= x * 2 / 3; middle.y -= y * 2 / 3; }
          for (const [node, id] of [[a, link.a], [b, link.b]] as const) if (grab?.index !== id) {
            node.x += x * (middleHeld ? 1 : 1 / 3); node.y += y * (middleHeld ? 1 : 1 / 3);
          }
          continue;
        }
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
  private displayPositions(): RopePosition[] {
    if (this.display) return this.display;
    let positions: RopePosition[] = this.nodes.map(n => ({ x: n.x, y: n.y }));
    const activity = this.nodes.map((_, i) => {
      const adjacent = [...(this.neighbors.get(i) ?? [])];
      if (adjacent.length !== 2 || this.grab?.index === i) return 0;
      const [a, b] = adjacent;
      const angle = (points: readonly RopePosition[]) => Math.atan2(points[b].y - points[i].y, points[b].x - points[i].x) - Math.atan2(points[i].y - points[a].y, points[i].x - points[a].x);
      const change = angle(this.nodes) - angle(this.restNodes);
      return Math.min(1, Math.abs(Math.atan2(Math.sin(change), Math.cos(change))) * 8);
    });
    // Regularize the center curve over neighboring material particles, not
    // individual capsules. A handoff shares this same display particle, while
    // free ends, branches and the held point stay exact;
    // a rigidly translated/rotated letter has zero curvature-change activity.
    for (let pass = 0; pass < 16; pass++) positions = positions.map((p, i) => {
      if (!activity[i]) return p;
      const [a, b] = [...this.neighbors.get(i)!];
      const t = .35 * activity[i];
      return { x: p.x + ((positions[a].x + positions[b].x) / 2 - p.x) * t,
        y: p.y + ((positions[a].y + positions[b].y) / 2 - p.y) * t };
    });
    // Two opposite length-projection sweeps reduce smoothing shrinkage. More
    // sweeps would push the original high-frequency folds back into the curve.
    const fixed = this.nodes.map((_, i) => this.neighbors.get(i)?.size !== 2 || this.grab?.index === i);
    const edges = this.links.filter(link => link.middle === undefined).map(link => ({ ...link,
      length: Math.hypot(this.nodes[link.b].x - this.nodes[link.a].x, this.nodes[link.b].y - this.nodes[link.a].y) }));
    for (let pass = 0; pass < 2; pass++) for (let index = 0; index < edges.length; index++) {
      const link = edges[pass % 2 ? edges.length - 1 - index : index], a = positions[link.a], b = positions[link.b];
      const free = Number(!fixed[link.a]) + Number(!fixed[link.b]);
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      if (!free || length < 1e-8) continue;
      const scale = (length - link.length) / length / free;
      if (!fixed[link.a]) { a.x += dx * scale; a.y += dy * scale; }
      if (!fixed[link.b]) { b.x -= dx * scale; b.y -= dy * scale; }
    }
    return this.display = positions;
  }
  private tangents(knots: readonly RopeKnot[], display: readonly RopePosition[]): RopePosition[] {
    const tangents = ropeTangents(knots, knots.map(k => display[k.node]));
    // Both sides of a material handoff use a shared derivative, including the
    // rest correction. Arbitrary SVG stroke boundaries do not pin the rope.
    for (const endpoint of [0, knots.length - 1]) {
      if (endpoint < 0 || knots.length < 2) continue;
      const knot = knots[endpoint], neighbors = [...(this.neighbors.get(knot.node) ?? [])];
      const inside = knots[endpoint === 0 ? 1 : endpoint - 1].node;
      const outside = neighbors.filter(node => node !== inside && node !== knot.node);
      if (outside.length !== 1) continue;
      const a = display[endpoint === 0 ? outside[0] : inside], b = display[endpoint === 0 ? inside : outside[0]];
      const span = Math.hypot(a.x - display[knot.node].x, a.y - display[knot.node].y) + Math.hypot(b.x - display[knot.node].x, b.y - display[knot.node].y) || 1;
      tangents[endpoint] = { x: (b.x - a.x) / span, y: (b.y - a.y) / span };
    }
    return tangents;
  }
  deformed(index: number): PenPath {
    const pen = this.pens[index], knots = this.knots[index];
    if (!knots.length) return pen;
    const display = this.displayPositions(), positions = knots.map(k => display[k.node]);
    return ropeCurve(pen, knots, positions, this.tangents(knots, display), this.tangents(knots, this.restNodes));
  }
}
