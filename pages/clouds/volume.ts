/** Authored volumes, independent of the reference implementation. World units are arbitrary. */
export type Formation = 'cumulus' | 'tower' | 'bank';
export const VOLUME_SIZE = [256, 192, 192] as const;
export const SHADOW_SIZE = [128, 96, 80] as const;
export const MIN = [-11, -1.5, -7] as const;
export const EXTENT = [22, 17, 14] as const;
export const DEFAULT_SEED = 7351;
const elevation = 38 * Math.PI / 180, azimuth = -65 * Math.PI / 180;
export const DEFAULT_SUN = [Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth)] as const;
export const EXTINCTION = 3.2;
export const SHADOW_STEP = 0.3;
export const SHADOW_STEPS = 112;
const MAGIC = 0x434c4431;

function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function smooth(a: number, b: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function hash(x: number, y: number, z: number, seed: number) {
  let h = Math.imul(x, 1597334677) ^ Math.imul(y, 3812015801) ^ Math.imul(z, 95868953) ^ seed;
  h = Math.imul(h ^ (h >>> 16), 2246822519);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}
function noise(x: number, y: number, z: number, seed: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = smooth(0, 1, x - ix), fy = smooth(0, 1, y - iy), fz = smooth(0, 1, z - iz);
  let value = 0;
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    value += hash(ix + dx, iy + dy, iz + dz, seed) * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
  }
  return value;
}
type Lobe = [number, number, number, number, number, number];
export function generateDensity(formation: Formation, seed: number, size: readonly number[] = VOLUME_SIZE) {
  const rng = random(seed), lobes: Lobe[] = [];
  const add = (x: number, y: number, z: number, rx: number, ry: number, rz: number) => {
    lobes.push([x, y, z, rx, ry, rz]);
  };
  if (formation === 'bank') {
    for (let z = -1; z <= 1; z++) for (let x = -2; x <= 2; x++) {
      add(x * 3.4 + rng(), 0.8 + rng(), z * 3.6, 2.2 + rng(), 1.2 + rng(), 2.1 + rng() * 0.4);
    }
  } else {
    add(-3.4, 0.7, 0, 4.5, 1.45, 3); add(2.5, 0.6, 0, 4.9, 1.3, 2.8);
    add(-4, 2.25, 0.1, 2.65, 2.4, 2.6); add(-0.6, 2.8, -0.4, 3, 2.85, 2.8);
    add(3.2, 2.05, 0.3, 2.6, 2, 2.4); add(6.2, 0.9, 0.5, 1.85, 1.2, 1.6);
    if (formation === 'tower') {
      add(-0.8, 6.5, -0.4, 3, 3.6, 2.7); add(0, 10, -0.6, 2.8, 3, 2.5);
      add(2.9, 5.3, 0.2, 2, 2.5, 2);
    }
  }
  const roots = lobes.slice(formation === 'bank' ? 0 : 2);
  for (const parent of roots) {
    for (let i = 0; i < 11; i++) {
      const phi = i * 2.399963 + rng() * 0.65, h = -0.2 + rng() * 1.1, r = Math.sqrt(1 - h * h);
      const scale = Math.min(parent[3], parent[4], parent[5]) * (0.22 + rng() * 0.25);
      const p: Lobe = [parent[0] + Math.cos(phi) * r * parent[3] * 0.84,
        parent[1] + h * parent[4] * 0.87, parent[2] + Math.sin(phi) * r * parent[5] * 0.84,
        scale, scale * (0.85 + rng() * 0.4), scale];
      lobes.push(p);
      for (let j = 0; j < 6; j++) {
        const angle = rng() * Math.PI * 2, up = rng() * 0.9, outward = Math.sqrt(1 - up * up), bud = scale * (0.26 + rng() * 0.21);
        add(p[0] + Math.cos(angle) * outward * scale * 0.9, p[1] + up * p[4] * 0.9,
          p[2] + Math.sin(angle) * outward * scale * 0.9, bud, bud, bud);
      }
    }
  }
  // Dense numeric bins and reciprocal radii keep random high-resolution generation off the hot string/Math.sqrt paths.
  type Kernel = [number, number, number, number, number, number, number];
  const cell = 2, origin = MIN.map(n => Math.floor(n / cell));
  const binSize = MIN.map((n, a) => Math.floor((n + EXTENT[a]) / cell) - origin[a] + 1);
  const bins: (Kernel[] | undefined)[] = new Array(binSize[0] * binSize[1] * binSize[2]);
  for (const l of lobes) {
    const kernel: Kernel = [l[0], l[1], l[2], 1 / l[3], 1 / l[4], 1 / l[5], Math.min(l[3], l[4], l[5])];
    const lo = [0, 1, 2].map(a => Math.max(0, Math.floor((l[a] - l[a + 3] - 0.5) / cell) - origin[a]));
    const hi = [0, 1, 2].map(a => Math.min(binSize[a] - 1, Math.floor((l[a] + l[a + 3] + 0.5) / cell) - origin[a]));
    for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
      const key = x + binSize[0] * (y + binSize[1] * z); (bins[key] ??= []).push(kernel);
    }
  }
  const [nx, ny, nz] = size, density = new Uint8Array(nx * ny * nz);
  const coordinates = size.map((n, a) => Float64Array.from({ length: n }, (_, i) => MIN[a] + (i + 0.5) / n * EXTENT[a]));
  const cells = coordinates.map((values, a) => Int32Array.from(values, value => Math.floor(value / cell) - origin[a]));
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const px = coordinates[0][x], py = coordinates[1][y], pz = coordinates[2][z];
    const nearby = bins[cells[0][x] + binSize[0] * (cells[1][y] + binSize[1] * cells[2][z])];
    if (!nearby || py < -0.25) continue;
    let field = -0.45, found = false;
    for (const l of nearby) {
      const limit = 1 - field / l[6];
      if (limit <= 0) continue;
      const dx = (px - l[0]) * l[3], dy = (py - l[1]) * l[4], dz = (pz - l[2]) * l[5];
      const squared = dx * dx + dy * dy + dz * dz;
      if (squared < limit * limit) { field = (1 - Math.sqrt(squared)) * l[6]; found = true; }
      if (field >= 0.8) break;
    }
    if (!found) continue;
    let value = 1;
    if (field < 0.8) {
      const coarse = noise(px * 1.1, py * 1.1, pz * 1.1, seed);
      const fine = noise(px * 3.8, py * 3.8, pz * 3.8, seed ^ 0x12345);
      const micro = noise(px * 7.4, py * 7.4, pz * 7.4, seed ^ 0x68bc21);
      value = smooth(-0.035, 0.11, field + (coarse - 0.53) * 0.65 + (fine - 0.5) * 0.24 + (micro - 0.5) * 0.08);
    }
    value *= smooth(-0.2, 0.25, py);
    density[x + nx * (y + ny * z)] = Math.round(value * 255);
  }
  return density;
}

/** Same normalized texture lookup as WebGL LINEAR, including half-texel positioning. */
export function densityAt(data: Uint8Array, point: readonly number[], size: readonly number[] = VOLUME_SIZE) {
  const uv = point.map((v, a) => (v - MIN[a]) / EXTENT[a]);
  if (uv.some(v => v < 0 || v > 1)) return 0;
  const p = uv.map((v, a) => v * size[a] - 0.5), base = p.map(Math.floor), f = p.map((v, a) => v - base[a]);
  let value = 0;
  for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    const ix = Math.max(0, Math.min(size[0] - 1, base[0] + x));
    const iy = Math.max(0, Math.min(size[1] - 1, base[1] + y));
    const iz = Math.max(0, Math.min(size[2] - 1, base[2] + z));
    value += data[ix + size[0] * (iy + size[1] * iz)] / 255 * (x ? f[0] : 1 - f[0]) * (y ? f[1] : 1 - f[1]) * (z ? f[2] : 1 - f[2]);
  }
  return value;
}
export function bakeShadow(data: Uint8Array, size: readonly number[] = VOLUME_SIZE, shadowSize: readonly number[] = SHADOW_SIZE) {
  const sun = normalize(DEFAULT_SUN), [nx, ny, nz] = shadowSize, shadow = new Uint8Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const p = [MIN[0] + (x + 0.5) / nx * EXTENT[0], MIN[1] + (y + 0.5) / ny * EXTENT[1], MIN[2] + (z + 0.5) / nz * EXTENT[2]];
    let tau = 0;
    for (let step = 0; step < SHADOW_STEPS; step++) {
      const d = (step + 0.5) * SHADOW_STEP;
      tau += densityAt(data, p.map((v, a) => v + sun[a] * d), size) * SHADOW_STEP * EXTINCTION;
      if (tau > 8) break;
    }
    shadow[x + nx * (y + ny * z)] = Math.round(Math.exp(-tau) * 255);
  }
  return shadow;
}
export function normalize(v: readonly number[]) {
  const length = Math.hypot(...v);
  return v.map(x => x / length);
}
export function encodeVolume(density: Uint8Array, shadow: Uint8Array, seed: number) {
  const buffer = new ArrayBuffer(16 + density.length + shadow.length), header = new DataView(buffer);
  header.setUint32(0, MAGIC, true); header.setUint32(4, seed, true);
  header.setUint32(8, density.length, true); header.setUint32(12, shadow.length, true);
  new Uint8Array(buffer, 16, density.length).set(density);
  new Uint8Array(buffer, 16 + density.length).set(shadow);
  return buffer;
}
export function decodeVolume(buffer: ArrayBuffer) {
  if (buffer.byteLength < 16) throw new Error('Cloud data is incomplete.');
  const header = new DataView(buffer), n = header.getUint32(8, true), m = header.getUint32(12, true);
  if (header.getUint32(0, true) !== MAGIC || n !== VOLUME_SIZE[0] * VOLUME_SIZE[1] * VOLUME_SIZE[2] || m !== SHADOW_SIZE[0] * SHADOW_SIZE[1] * SHADOW_SIZE[2] || buffer.byteLength !== 16 + n + m) {
    throw new Error('Cloud data has an unsupported format.');
  }
  return { seed: header.getUint32(4, true), density: new Uint8Array(buffer, 16, n), shadow: new Uint8Array(buffer, 16 + n, m) };
}
