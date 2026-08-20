export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function hash(a: number, b: number, c = 0): number {
  const value = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
  return value - Math.floor(value);
}

export function smoothstep(value: number): number {
  const progress = clamp(value, 0, 1);
  return progress * progress * (3 - 2 * progress);
}
