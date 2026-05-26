export const GOOGLE_COLORS = Object.freeze(['#4285F4', '#EA4335', '#FBBC05', '#34A853']);
export const TOKENS = Object.freeze(['LINK', 'VOTE', 'RANK', 'PAGE', 'SEARCH', 'INDEX', 'CRAWL', 'PR', 'QUERY', 'SCORE', 'WEB']);

const TWO_PI = Math.PI * 2;

export function buildCharacterBelt(tokens, charSpacing, beltLength, tokenOffset = 0) {
  const cleanTokens = tokens
    .map((token) => String(token).replace(/\s+/g, ''))
    .filter((token) => token.length > 0);
  const glyphs = [];

  if (cleanTokens.length === 0 || charSpacing <= 0 || beltLength <= 0) return glyphs;

  let distance = 0;
  let tokenCursor = 0;
  while (distance < beltLength) {
    const tokenIndex = mod(tokenOffset + tokenCursor, cleanTokens.length);
    const token = cleanTokens[tokenIndex];
    for (let charIndex = 0; charIndex < token.length && distance < beltLength; charIndex++) {
      glyphs.push({
        char: token[charIndex],
        distance,
        tokenIndex,
        charIndex,
      });
      distance += charSpacing;
    }
    tokenCursor++;
  }

  return glyphs;
}

export function paintGlyphsInBrush(glyphs, positions, brush) {
  if (!brush || brush.radius <= 0 || !brush.color) return 0;

  const radiusSquared = brush.radius * brush.radius;
  let painted = 0;

  for (let index = 0; index < glyphs.length && index < positions.length; index++) {
    const glyph = glyphs[index];
    const position = positions[index];

    if (!glyph || !position) continue;

    const dx = position.x - brush.x;
    const dy = position.y - brush.y;

    if (dx * dx + dy * dy <= radiusSquared) {
      glyph.paintColor = brush.color;
      painted++;
    }
  }

  return painted;
}

export function createGoogleGMask(width, height) {
  const size = Math.min(width * 1.02, height * 0.86);
  const outer = size * 0.5;
  const inner = outer * 0.54;
  const cx = width * 0.5;
  const cy = height * 0.5;
  const scale = size / 1080;

  function contains(x, y) {
    const nx = (x - cx) / outer;
    const ny = (y - cy) / outer;
    const r = Math.hypot(nx, ny);
    if (r > 1) return false;

    const inBar = nx > 0.05 && nx < 0.86 && Math.abs(ny) < 0.155 && r > 0.36;
    const inRing = r >= inner / outer && r <= 1;
    const rightOpening = nx > 0.56 && ny > -0.33 && ny < 0.2;

    return inBar || (inRing && !rightOpening);
  }

  return { width, height, size, outer, inner, cx, cy, scale, contains };
}

export function generateLoops({ width, height, seed = 8421, targetCount = 45, mask = createGoogleGMask(width, height) }) {
  const rng = mulberry32(seed);
  const loops = [];
  const minRadius = Math.max(14, mask.scale * 22);
  const maxRadius = Math.max(minRadius + 8, mask.scale * 58);
  const maxAttempts = targetCount * 520;

  for (let attempt = 0; attempt < maxAttempts && loops.length < targetCount; attempt++) {
    const point = sampleMaskPoint(mask, rng, attempt);
    if (!point) continue;

    const clearance = estimateClearance(mask, point.x, point.y, maxRadius * 1.35);
    if (clearance < minRadius * 1.05) continue;

    const radius = clamp(clearance * (0.58 + rng() * 0.18), minRadius, maxRadius);
    const spacingFactor = attempt < maxAttempts * 0.55 ? 0.86 : 0.68;
    if (!canPlaceLoop(loops, point.x, point.y, radius, spacingFactor)) continue;

    const loop = createOrganicLoop(loops.length, point.x, point.y, radius, rng, mask);
    if (loop.insideRatio < 0.76) continue;
    loops.push(loop);
  }

  let rescueAttempts = 0;
  while (loops.length < Math.min(35, targetCount) && rescueAttempts < 5000) {
    rescueAttempts++;
    const point = sampleMaskPoint(mask, rng, rescueAttempts + maxAttempts);
    if (!point) continue;

    const clearance = estimateClearance(mask, point.x, point.y, maxRadius);
    if (clearance < minRadius * 0.76) continue;

    const radius = clamp(clearance * 0.48, minRadius * 0.72, maxRadius * 0.78);
    if (!canPlaceLoop(loops, point.x, point.y, radius, 0.53)) continue;

    const loop = createOrganicLoop(loops.length, point.x, point.y, radius, rng, mask);
    if (loop.insideRatio < 0.72) continue;
    loops.push(loop);
  }

  return loops.map((loop, id) => ({
    ...loop,
    id,
    colorIndex: getRegionColorIndex(loop.cx, loop.cy, mask),
    direction: id % 2 === 0 ? 1 : -1,
    speed: (24 + rng() * 28) * (0.7 + mask.scale * 0.35),
    phase: rng() * loop.length,
    tokenOffset: Math.floor(rng() * TOKENS.length),
  }));
}

export function buildContactGraph(loops, threshold) {
  const adjacency = loops.map(() => []);
  const allPairs = [];
  const added = new Set();

  for (let i = 0; i < loops.length; i++) {
    for (let j = i + 1; j < loops.length; j++) {
      const centerDistance = Math.hypot(loops[i].cx - loops[j].cx, loops[i].cy - loops[j].cy);
      if (centerDistance > loops[i].radius + loops[j].radius + threshold * 5.5) continue;

      const pair = nearestPathPair(loops[i], loops[j]);
      allPairs.push({ i, j, ...pair });
      if (pair.distance <= threshold) {
        addGraphEdge(adjacency, added, i, j, pair);
      }
    }
  }

  allPairs.sort((a, b) => a.distance - b.distance);
  const dsu = new DisjointSet(loops.length);
  for (let i = 0; i < adjacency.length; i++) {
    for (const edge of adjacency[i]) {
      if (i < edge.to) dsu.union(i, edge.to);
    }
  }

  for (const pair of allPairs) {
    if (dsu.count === 1) break;
    if (dsu.find(pair.i) === dsu.find(pair.j)) continue;
    addGraphEdge(adjacency, added, pair.i, pair.j, pair, true);
    dsu.union(pair.i, pair.j);
  }

  const edgeCount = adjacency.reduce((sum, edges) => sum + edges.length, 0) / 2;
  return { adjacency, edgeCount };
}

export function createPropagationSchedule(loops, graph, seedIndex = 0) {
  const n = loops.length;
  if (n === 0) return [];

  const source = clamp(Math.round(seedIndex), 0, n - 1);
  const distance = Array.from({ length: n }, () => Infinity);
  const visited = Array.from({ length: n }, () => false);
  distance[source] = 0;

  for (let step = 0; step < n; step++) {
    let current = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      if (!visited[i] && distance[i] < best) {
        best = distance[i];
        current = i;
      }
    }
    if (current === -1) break;
    visited[current] = true;

    for (const edge of graph.adjacency[current] || []) {
      const loop = loops[current];
      const travel = loop.length > 0 ? edge.at / loop.length : 0;
      const delay = 0.34 + travel * 0.82 + Math.min(edge.distance / Math.max(24, loop.radius * 2), 0.75);
      const candidate = distance[current] + delay;
      if (candidate < distance[edge.to]) distance[edge.to] = candidate;
    }
  }

  let maxFinite = 0;
  for (const value of distance) {
    if (Number.isFinite(value)) maxFinite = Math.max(maxFinite, value);
  }

  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(distance[i])) {
      const dx = loops[i].cx - loops[source].cx;
      const dy = loops[i].cy - loops[source].cy;
      distance[i] = maxFinite + 0.8 + Math.hypot(dx, dy) / 420;
    }
  }

  maxFinite = Math.max(...distance);
  const spread = 8.25;
  return distance.map((value) => 1 + (maxFinite > 0 ? (value / maxFinite) * spread : 0));
}

export function findSeedLoop(loops, mask) {
  if (loops.length === 0) return 0;
  const tx = mask.cx - mask.outer * 0.42;
  const ty = mask.cy - mask.outer * 0.38;
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < loops.length; i++) {
    const distance = Math.hypot(loops[i].cx - tx, loops[i].cy - ty);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
}

export function findNearestLoop(loops, x, y) {
  let bestIndex = -1;
  let bestDistance = Infinity;

  for (let i = 0; i < loops.length; i++) {
    const samples = loops[i].samples;
    for (let k = 0; k < samples.length; k += 5) {
      const point = samples[k];
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
  }

  return { index: bestIndex, distance: bestDistance };
}

export function pointAt(loop, distance) {
  const samples = loop.samples;
  if (!samples.length) return { x: loop.cx, y: loop.cy, angle: 0, s: 0 };

  const wrapped = mod(distance, loop.length);
  let lo = 0;
  let hi = samples.length - 1;

  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (samples[mid].s <= wrapped) lo = mid;
    else hi = mid - 1;
  }

  const a = samples[lo];
  const b = samples[(lo + 1) % samples.length];
  const segmentLength = lo === samples.length - 1 ? loop.length - a.s : b.s - a.s;
  const t = segmentLength > 0 ? (wrapped - a.s) / segmentLength : 0;
  const x = lerp(a.x, b.x, t);
  const y = lerp(a.y, b.y, t);
  return { x, y, angle: Math.atan2(b.y - a.y, b.x - a.x), s: wrapped };
}

function createOrganicLoop(id, cx, cy, radius, rng, mask) {
  const controlCount = 8 + Math.floor(rng() * 7);
  const angleStep = TWO_PI / controlCount;
  const xSquash = 0.86 + rng() * 0.28;
  const ySquash = 0.86 + rng() * 0.28;
  const points = [];

  for (let i = 0; i < controlCount; i++) {
    const angle = i * angleStep + (rng() - 0.5) * angleStep * 0.5;
    const radial = radius * (0.76 + rng() * 0.44);
    points.push({
      x: cx + Math.cos(angle) * radial * xSquash,
      y: cy + Math.sin(angle) * radial * ySquash,
    });
  }

  const samples = sampleClosedCatmull(points, 10);
  const measured = measureSamples(samples);
  let inside = 0;
  for (const sample of measured.samples) {
    if (mask.contains(sample.x, sample.y)) inside++;
  }

  return {
    id,
    cx,
    cy,
    radius,
    points,
    samples: measured.samples,
    length: measured.length,
    bounds: measured.bounds,
    insideRatio: inside / measured.samples.length,
  };
}

function sampleClosedCatmull(points, samplesPerSegment) {
  const samples = [];
  for (let i = 0; i < points.length; i++) {
    const p0 = points[(i - 1 + points.length) % points.length];
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const p3 = points[(i + 2) % points.length];

    for (let j = 0; j < samplesPerSegment; j++) {
      const t = j / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      samples.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return samples;
}

function measureSamples(samples) {
  let length = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < samples.length; i++) {
    const current = samples[i];
    const next = samples[(i + 1) % samples.length];
    current.s = length;
    minX = Math.min(minX, current.x);
    minY = Math.min(minY, current.y);
    maxX = Math.max(maxX, current.x);
    maxY = Math.max(maxY, current.y);
    length += Math.hypot(next.x - current.x, next.y - current.y);
  }

  return { samples, length, bounds: { minX, minY, maxX, maxY } };
}

function sampleMaskPoint(mask, rng, attempt) {
  for (let tries = 0; tries < 44; tries++) {
    let x;
    let y;
    const mode = (rng() + (attempt % 9) * 0.013) % 1;

    if (mode < 0.24) {
      x = mask.cx + mask.outer * (0.08 + rng() * 0.72);
      y = mask.cy + mask.outer * ((rng() - 0.5) * 0.22);
    } else if (mode < 0.68) {
      const angle = rng() * TWO_PI;
      const r = mask.outer * (0.58 + rng() * 0.36);
      x = mask.cx + Math.cos(angle) * r;
      y = mask.cy + Math.sin(angle) * r;
    } else {
      x = mask.cx - mask.outer + rng() * mask.outer * 2;
      y = mask.cy - mask.outer + rng() * mask.outer * 2;
    }

    if (mask.contains(x, y)) return { x, y };
  }
  return null;
}

function estimateClearance(mask, x, y, maxRadius) {
  const step = Math.max(4, mask.scale * 5);
  let radius = step;

  while (radius <= maxRadius) {
    let ok = true;
    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * TWO_PI;
      if (!mask.contains(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius)) {
        ok = false;
        break;
      }
    }
    if (!ok) return radius - step;
    radius += step;
  }

  return maxRadius;
}

function canPlaceLoop(loops, x, y, radius, factor) {
  for (const loop of loops) {
    const distance = Math.hypot(loop.cx - x, loop.cy - y);
    if (distance < (loop.radius + radius) * factor) return false;
  }
  return true;
}

function nearestPathPair(a, b) {
  let best = {
    distance: Infinity,
    atA: 0,
    atB: 0,
  };
  const strideA = Math.max(2, Math.floor(a.samples.length / 28));
  const strideB = Math.max(2, Math.floor(b.samples.length / 28));

  for (let i = 0; i < a.samples.length; i += strideA) {
    const pa = a.samples[i];
    for (let j = 0; j < b.samples.length; j += strideB) {
      const pb = b.samples[j];
      const distance = Math.hypot(pa.x - pb.x, pa.y - pb.y);
      if (distance < best.distance) {
        best = { distance, atA: pa.s, atB: pb.s };
      }
    }
  }

  return best;
}

function addGraphEdge(adjacency, added, i, j, pair, synthetic = false) {
  const key = `${Math.min(i, j)}:${Math.max(i, j)}`;
  if (added.has(key)) return;
  added.add(key);
  adjacency[i].push({ to: j, distance: pair.distance, at: pair.atA, otherAt: pair.atB, synthetic });
  adjacency[j].push({ to: i, distance: pair.distance, at: pair.atB, otherAt: pair.atA, synthetic });
}

function getRegionColorIndex(x, y, mask) {
  if (x < mask.cx && y < mask.cy) return 0;
  if (x >= mask.cx && y < mask.cy) return 1;
  if (x >= mask.cx && y >= mask.cy) return 2;
  return 3;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return function next() {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class DisjointSet {
  constructor(size) {
    this.parent = Array.from({ length: size }, (_, index) => index);
    this.count = size;
  }

  find(value) {
    let root = value;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[value] !== value) {
      const next = this.parent[value];
      this.parent[value] = root;
      value = next;
    }
    return root;
  }

  union(a, b) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    this.parent[rootB] = rootA;
    this.count--;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}
