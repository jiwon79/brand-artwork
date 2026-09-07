export type ModelName = 'smiley' | 'flower';

export const FLIP_DURATION: Record<ModelName, number> = { flower: 0.31, smiley: 0.83 };
export const RIPPLE_PERIOD = 4;
export const REST_ANGLE: Record<ModelName, number> = { flower: 0, smiley: -0.28 };

export function otherModel(model: ModelName): ModelName {
  return model === 'smiley' ? 'flower' : 'smiley';
}

// Cubic Bezier with horizontal endpoint tangents. Invert x before evaluating y:
// using the curve parameter as time changes the acceleration substantially.
function cubicEase(time: number, x1: number, x2: number) {
  if (time <= 0) return 0;
  if (time >= 1) return 1;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 18; i++) {
    const u = (low + high) * 0.5;
    const x = 3 * (1 - u) ** 2 * u * x1 + 3 * (1 - u) * u * u * x2 + u ** 3;
    if (x < time) low = u;
    else high = u;
  }
  const u = (low + high) * 0.5;
  return u * u * (3 - 2 * u);
}

export function sampleFlip(from: ModelName, progress: number) {
  // Estimated from the reference's projected petal height and eye apertures at
  // 30 fps. The flower return has a much longer deceleration than its opening.
  const eased = from === 'flower' ? cubicEase(progress, 0.28, 0.65) : cubicEase(progress, 0.12, 0.145);
  const target = otherModel(from);
  const direction = from === 'flower' ? 1 : -1;
  const angle = REST_ANGLE[from] + (direction * Math.PI + REST_ANGLE[target] - REST_ANGLE[from]) * eased;
  const incoming = direction * angle >= Math.PI / 2;
  return {
    model: incoming ? target : from,
    rotationX: angle - (incoming ? direction * Math.PI : 0),
  };
}

export function sampleRipple(time: number, radius: number) {
  const phase = ((time % RIPPLE_PERIOD) + RIPPLE_PERIOD) % RIPPLE_PERIOD;
  // Twenty blue/green cells reveal two nearly constant-speed radial fronts.
  // The first begins across a central disk; the return begins at the center.
  const openAt = 0.21 * Math.max(0, radius - 2.17);
  const closeAt = 0.47 + 0.22 * radius;
  if (phase < openAt) return { model: 'flower' as const, rotationX: REST_ANGLE.flower };
  if (phase < openAt + FLIP_DURATION.flower) return sampleFlip('flower', (phase - openAt) / FLIP_DURATION.flower);
  if (phase < closeAt) return { model: 'smiley' as const, rotationX: REST_ANGLE.smiley };
  if (phase < closeAt + FLIP_DURATION.smiley) return sampleFlip('smiley', (phase - closeAt) / FLIP_DURATION.smiley);
  return { model: 'flower' as const, rotationX: REST_ANGLE.flower };
}
