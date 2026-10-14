export type RenderPhase = 'moving' | 'settling' | 'ready';
export const SETTLE_DELAY = 180;
export function renderPlan(moving: boolean, detail: 'balanced' | 'high' = 'balanced') {
  return moving
    ? { scale: 0.5, steps: 48, samples: 1 }
    : { scale: detail === 'high' ? 1 : 0.75, steps: detail === 'high' ? 160 : 128, samples: detail === 'high' ? 64 : 24 };
}
/** Bound allocation on high-DPI/4K screens, preserving aspect ratio. */
export function outputSize(width: number, height: number, dpr: number) {
  const scale = Math.min(dpr, 1.5, 1600 / Math.max(width, height));
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))] as const;
}
export function feedbackScale(scale: number, milliseconds: number) {
  // Adjust pixels, not the authored 3D volume. Quantization avoids reallocating on every frame.
  if (milliseconds > 24) return Math.max(0.3, Math.round((scale - 0.05) * 20) / 20);
  if (milliseconds < 12) return Math.min(0.5, Math.round((scale + 0.05) * 20) / 20);
  return scale;
}
