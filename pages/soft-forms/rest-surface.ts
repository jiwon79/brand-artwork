import { shapeFactor, variants, type VariantId } from './variants';

export function restRadius(shape: VariantId, x: number, y: number, baseline: ArrayLike<number>) {
  const mean = Array.from(baseline).reduce((sum, r) => sum + r, 0) / baseline.length;
  const angle = Math.atan2(y, x);
  const sample = ((-angle + Math.PI * 2) % (Math.PI * 2)) * baseline.length / (Math.PI * 2) - 0.5;
  const first = ((Math.floor(sample) % baseline.length) + baseline.length) % baseline.length;
  const fraction = sample - Math.floor(sample);
  const t = Math.max(0, Math.min(1, (-x - 0.3) / 0.65));
  const expansion = 0.94 + t * t * (3 - 2 * t) * 0.1;
  const contour = (baseline[first] * (1 - fraction) + baseline[(first + 1) % baseline.length] * fraction) * expansion;
  const detail = variants.find((variant) => variant.id === shape)!.referenceDetail;
  const blend = Math.min(1, Math.hypot(x, y)) ** 0.7;
  return (mean + blend * detail * (contour - mean)) * shapeFactor(shape, angle);
}

export function restSurface(shape: VariantId, x: number, y: number, z: number, baseline: ArrayLike<number>, target: Float32Array, offset = 0) {
  const radius = restRadius(shape, x, y, baseline);
  const depth = variants.find((variant) => variant.id === shape)!.depth;
  const crest = shape === 'wave' ? Math.exp(-Math.pow((x - 0.59) / 0.26, 2) - Math.pow((y - 0.74) / 0.26, 2)) : 0;
  target[offset] = x * radius - 80 * crest;
  target[offset + 1] = y * radius + (shape === 'wave' ? 16 * x + 4 * Math.sin(5.6 * x + 0.7) + 50 * crest : 0);
  target[offset + 2] = z * 116 * depth;
}
