export type ModelName = 'smiley' | 'flower';

export const FLIP_DURATION = 0.64;

export function otherModel(model: ModelName): ModelName {
  return model === 'smiley' ? 'flower' : 'smiley';
}

export function sampleFlip(from: ModelName, progress: number) {
  const t = Math.max(0, Math.min(1, progress));
  // A half turn with zero speed and acceleration at both ends. The outgoing
  // face reaches +90°, then the incoming face continues from -90° to the front.
  // Swap only at the edge, where their centered thicknesses nearly coincide.
  const eased = t * t * t * (t * (t * 6 - 15) + 10);
  const incoming = t >= 0.5;
  return {
    model: incoming ? otherModel(from) : from,
    rotationX: Math.PI * (eased - (incoming ? 1 : 0)),
  };
}
