export type ModelName = 'smiley' | 'flower';

export const FLIP_DURATION = 0.32;
export const RIPPLE_PERIOD = 4;
export const REST_ANGLE: Record<ModelName, number> = { flower: 0, smiley: -0.28 };

export function otherModel(model: ModelName): ModelName {
  return model === 'smiley' ? 'flower' : 'smiley';
}

export function sampleFlip(from: ModelName, progress: number) {
  const t = Math.max(0, Math.min(1, progress));
  const eased = t * t * t * (t * (t * 6 - 15) + 10);
  const target = otherModel(from);
  // The reference folds forward into a smiley, then unfolds along the same
  // path into a flower; the return is not another turn in the same direction.
  const direction = from === 'flower' ? 1 : -1;
  const angle = REST_ANGLE[from] + (direction * Math.PI + REST_ANGLE[target] - REST_ANGLE[from]) * eased;
  const incoming = direction * angle >= Math.PI / 2;
  return {
    model: incoming ? target : from,
    rotationX: angle - (incoming ? direction * Math.PI : 0),
  };
}

// The reference repeats every four seconds. Its circular front slows as it
// expands, and the smiley band becomes slightly wider away from the center.
export function sampleRipple(time: number, radius: number) {
  const phase = ((time % RIPPLE_PERIOD) + RIPPLE_PERIOD) % RIPPLE_PERIOD;
  const delay = Math.max(0, 0.054 * (radius ** 1.5 - 1));
  const local = phase - delay;
  const returnAt = 0.7 + 0.36 * (1 - Math.exp(-Math.max(0, radius - 1) / 1.5));
  if (local < 0) return { model: 'flower' as const, rotationX: REST_ANGLE.flower };
  if (local < FLIP_DURATION) return sampleFlip('flower', local / FLIP_DURATION);
  if (local < returnAt) return { model: 'smiley' as const, rotationX: REST_ANGLE.smiley };
  if (local < returnAt + 0.38) return sampleFlip('smiley', (local - returnAt) / 0.38);
  return { model: 'flower' as const, rotationX: REST_ANGLE.flower };
}
