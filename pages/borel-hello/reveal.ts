import type { Point } from './lettering';

/** Zhang–Suen thinning: derive a center graph from the actual filled glyph. */
export function skeletonize(alpha: Uint8Array, width: number, height: number): Uint8Array {
  const pixels = Uint8Array.from(alpha, value => value >= 128 ? 1 : 0);
  const remove: number[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      remove.length = 0;
      for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        if (!pixels[i]) continue;
        const p = [pixels[i - width], pixels[i - width + 1], pixels[i + 1], pixels[i + width + 1], pixels[i + width], pixels[i + width - 1], pixels[i - 1], pixels[i - width - 1]];
        const count = p.reduce((a, b) => a + b, 0);
        if (count < 2 || count > 6) continue;
        let transitions = 0;
        for (let j = 0; j < 8; j++) if (!p[j] && p[(j + 1) % 8]) transitions++;
        if (transitions !== 1) continue;
        if (pass === 0 ? p[0] * p[2] * p[4] || p[2] * p[4] * p[6] : p[0] * p[2] * p[6] || p[0] * p[4] * p[6]) continue;
        remove.push(i);
      }
      if (remove.length) changed = true;
      for (const i of remove) pixels[i] = 0;
    }
  }
  return pixels;
}

/** Visit each graph edge once, continuing straight through a crossing. */
export function traceSkeleton(pixels: Uint8Array, width: number, height: number): Point[][] {
  const graph = new Map<number, number[]>();
  for (let i = 0; i < pixels.length; i++) if (pixels[i]) {
    const x = i % width, y = Math.floor(i / width), neighbours: number[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy || x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
      const next = i + dy * width + dx;
      if (!pixels[next]) continue;
      // An orthogonal edge already connects these pixels; avoid tiny triangles.
      if (dx && dy && (pixels[i + dx] || pixels[i + dy * width])) continue;
      neighbours.push(next);
    }
    graph.set(i, neighbours);
  }
  const components: number[][] = [], seen = new Set<number>();
  for (const id of graph.keys()) if (!seen.has(id)) {
    const component = [id]; seen.add(id);
    for (let j = 0; j < component.length; j++) for (const n of graph.get(component[j])!) if (!seen.has(n)) { seen.add(n); component.push(n); }
    components.push(component);
  }
  // Group horizontally overlapping components: connected word bodies and
  // their dots stay together, while separate words/capitals proceed left to right.
  const groups: { left: number; right: number; components: number[][] }[] = [];
  const boxes = components.map(component => ({ component, left: Math.min(...component.map(i => i % width)), right: Math.max(...component.map(i => i % width)) })).sort((a, b) => a.left - b.left);
  for (const box of boxes) {
    const group = groups[groups.length - 1];
    if (group && box.left <= group.right) { group.right = Math.max(group.right, box.right); group.components.push(box.component); }
    else groups.push({ left: box.left, right: box.right, components: [box.component] });
  }
  components.length = 0;
  for (const group of groups) components.push(...group.components.sort((a, b) => b.length - a.length));
  const paths: Point[][] = [];
  const point = (i: number): Point => [i % width + .5, Math.floor(i / width) + .5];
  for (const component of components) {
    const edges = new Set<string>();
    const key = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;
    for (const a of component) for (const b of graph.get(a)!) edges.add(key(a, b));
    if (!edges.size) { paths.push([point(component[0])]); continue; }
    let last: number | undefined;
    while (edges.size) {
      const candidates = component.filter(i => graph.get(i)!.some(n => edges.has(key(i, n))));
      const endpoints = candidates.filter(i => graph.get(i)!.filter(n => edges.has(key(i, n))).length === 1);
      const starts = endpoints.length ? endpoints : candidates;
      starts.sort((a, b) => last === undefined ? a % width - b % width || b - a :
        Math.hypot(a % width - last % width, Math.floor(a / width) - Math.floor(last / width)) - Math.hypot(b % width - last % width, Math.floor(b / width) - Math.floor(last / width)));
      let current = starts[0], previous: number | undefined;
      const path = [point(current)];
      while (true) {
        const next = graph.get(current)!.filter(n => edges.has(key(current, n)));
        if (!next.length) break;
        if (previous !== undefined) {
          const [x, y] = point(current), [px, py] = path[Math.max(0, path.length - 8)];
          next.sort((a, b) => {
            const score = (n: number) => {
              let ahead = n, behind = current;
              for (let step = 0; step < 8; step++) {
                const onward = graph.get(ahead)!.filter(id => id !== behind && edges.has(key(ahead, id)));
                if (!onward.length) break;
                const [ax, ay] = point(ahead);
                onward.sort((a, b) => {
                  const direction = (id: number) => { const [nx, ny] = point(id); return ((nx - ax) * (x - px) + (ny - ay) * (y - py)) / Math.hypot(nx - ax, ny - ay); };
                  return direction(b) - direction(a);
                });
                behind = ahead; ahead = onward[0];
              }
              const [nx, ny] = point(ahead);
              return ((nx - x) * (x - px) + (ny - y) * (y - py)) / Math.hypot(nx - x, ny - y);
            };
            return score(b) - score(a);
          });
        }
        const n = next[0]; edges.delete(key(current, n)); previous = current; current = n; path.push(point(current));
      }
      paths.push(path); last = current;
    }
  }
  return paths;
}

export interface Seed { x: number; y: number; time: number }
export interface RoundTip { radius: number }

/** Exact squared Euclidean distance transform, preserving each nearest seed's time.
 * Every ink pixel belongs to one trajectory point. A crossing cannot uncover a
 * future branch merely because a broad brush overlaps it.
 */
export function revealTimes(width: number, height: number, seeds: readonly Seed[], tip?: RoundTip): Float32Array {
  const size = width * height;
  const costs = new Float64Array(size).fill(1e12), times = new Float32Array(size).fill(1);
  for (const seed of seeds) {
    const x = Math.max(0, Math.min(width - 1, Math.round(seed.x))), y = Math.max(0, Math.min(height - 1, Math.round(seed.y)));
    const i = y * width + x;
    times[i] = costs[i] === 0 ? Math.min(times[i], seed.time) : seed.time; costs[i] = 0;
  }
  const n = Math.max(width, height), f = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1), indexes = new Int32Array(n), distances = new Float64Array(n);
  function transform(length: number) {
    let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < length; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < length; q++) { while (z[k + 1] < q) k++; indexes[q] = v[k]; distances[q] = (q - v[k]) ** 2 + f[v[k]]; }
  }
  const rowTimes = new Float32Array(size);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = costs[y * width + x];
    transform(width);
    for (let x = 0; x < width; x++) { costs[y * width + x] = distances[x]; rowTimes[y * width + x] = times[y * width + indexes[x]]; }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = costs[y * width + x];
    transform(height);
    for (let y = 0; y < height; y++) times[y * width + x] = rowTimes[indexes[y] * width + x];
  }
  if (tip) {
    // A small round pen head covers the shared center of a crossing. Its reach
    // is limited to the font's stroke radius; the rest retains trajectory ownership.
    const radius = tip.radius;
    for (const seed of seeds) {
      const y0 = Math.max(0, Math.ceil(seed.y - radius)), y1 = Math.min(height - 1, Math.floor(seed.y + radius));
      for (let y = y0; y <= y1; y++) {
        const half = Math.sqrt(Math.max(0, radius * radius - (y - seed.y) ** 2));
        const x0 = Math.max(0, Math.ceil(seed.x - half)), x1 = Math.min(width - 1, Math.floor(seed.x + half));
        for (let x = x0; x <= x1; x++) times[y * width + x] = Math.min(times[y * width + x], seed.time);
      }
    }
  }
  return times;
}

/** Source RGB and alpha are immutable. Completion is a byte-for-byte copy. */
export function revealFrame(source: Uint8ClampedArray, times: Float32Array, progress: number, output: Uint8ClampedArray, softness = .001): void {
  output.set(source);
  if (progress >= 1) return;
  for (let i = 0; i < times.length; i++) {
    const coverage = progress <= 0 ? 0 : Math.max(0, Math.min(1, (progress - times[i]) / softness + .5));
    output[i * 4 + 3] = Math.round(source[i * 4 + 3] * coverage);
  }
}
