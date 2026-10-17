export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const mix = (a, b, t) => a + (b - a) * t;
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const normalize = a => { const l = Math.hypot(...a); return a.map(x => x / (l || 1)); };
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export function randomGenerator(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Numerical Recipes erfc approximation. Maximum absolute error ~1.2e-7.
// erfc is evaluated directly: 1-erf(x) loses the positive tail to cancellation.
export function erfc(x) {
  const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x < 0 ? 2 - r : r;
}

// Integral of peak * exp(-0.5 * sum(((x-mean)/sigma)^2)) along a unit ray.
// Non-unit directions are supported: the result is with respect to parameter t.
export function gaussianIntegral(mean, sigma, peak, origin, direction, near = 0, far = Infinity) {
  if (sigma.some(s => !(s > 0)) || peak < 0 || far < near || !Number.isFinite(near)) throw new RangeError('Invalid Gaussian or interval');
  const m = origin.map((v, i) => (v - mean[i]) / sigma[i]);
  const d = direction.map((v, i) => v / sigma[i]);
  const a = dot(d, d);
  if (!(a > 0)) throw new RangeError('Ray direction must be nonzero');
  const b = dot(m, d), center = -b / a;
  const closest = m.map((v, i) => v + d[i] * center);
  const scale = Math.sqrt(a / 2);
  const lo = (near - center) * scale, hi = (far - center) * scale;
  // Evaluate the tail with the smaller cancellation error on either side.
  const mass = lo > 0 ? erfc(lo) - erfc(hi) : hi < 0 ? erfc(-hi) - erfc(-lo) : 2 - erfc(-lo) - erfc(hi);
  return Math.max(0, peak * Math.exp(-0.5 * dot(closest, closest)) * Math.sqrt(Math.PI / (2 * a)) * mass);
}

export function sunDirection(elevation, azimuth) {
  const e = elevation * Math.PI / 180, a = azimuth * Math.PI / 180;
  return [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)];
}
export function lightBasis(direction) {
  const right = normalize(cross(Math.abs(direction[1]) > 0.98 ? [0, 0, 1] : [0, 1, 0], direction));
  return { right, up: normalize(cross(direction, right)), forward: direction };
}
