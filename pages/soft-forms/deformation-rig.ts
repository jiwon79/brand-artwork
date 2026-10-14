import { shapeFactor, type VariantId } from './variants';

// Thirteen independent planar controls: one at the center and twelve around the rim.
// Every surface point blends rigid transforms from nearby controls.
export const controlDefinitions = [
  { name: '몸통 중심', x: 0, y: 0 },
  ...['오른쪽', '오른쪽 아래', '아래 오른쪽', '아래', '아래 왼쪽', '왼쪽 아래',
    '왼쪽', '왼쪽 위', '위 왼쪽', '위', '위 오른쪽', '오른쪽 위'].map((name, index) => {
    const angle = -index * Math.PI / 6;
    return { name, x: 105 * Math.cos(angle), y: 105 * Math.sin(angle) };
  }),
];
export function controlDefinitionsFor(shape: VariantId) {
  if (shape === 'original') return controlDefinitions;
  return controlDefinitions.map((control, index) => {
    if (index === 0) return { ...control };
    const angle = Math.atan2(control.y, control.x);
    const factor = shapeFactor(shape, angle);
    const x = control.x * factor, y = control.y * factor;
    return { ...control, x, y: y + (shape === 'wave' ? x * 0.15 : 0) };
  });
}
export type ControlPose = { dx: number; dy: number; angle: number };
export const neutralControlPose = (): ControlPose[] => controlDefinitions.map(() => ({ dx: 0, dy: 0, angle: 0 }));

export class DeformationRig {
  readonly definitions;
  constructor(readonly shape: VariantId = 'original') {
    this.definitions = controlDefinitionsFor(shape);
  }
  readonly poses = neutralControlPose();
  private readonly cosines = new Float32Array(controlDefinitions.length).fill(1);
  private readonly sines = new Float32Array(controlDefinitions.length);

  weightsFor(x: number, y: number) {
    const weights = new Float32Array(controlDefinitions.length);
    weights[0] = 1.8 * Math.exp(-(x * x + y * y) / (2 * 68 ** 2));
    let total = weights[0];
    for (let index = 1; index < controlDefinitions.length; index++) {
      const control = this.definitions[index];
      const distance = (x - control.x) ** 2 + (y - control.y) ** 2;
      const weight = Math.exp(-distance / (2 * 43 ** 2));
      weights[index] = weight;
      total += weight;
    }
    for (let index = 0; index < weights.length; index++) weights[index] /= total;
    return weights;
  }

  setPose(poses: readonly ControlPose[], response = 1) {
    for (let index = 0; index < this.poses.length; index++) {
      const source = poses[index], pose = this.poses[index];
      pose.dx = source.dx * response;
      pose.dy = source.dy * response;
      pose.angle = source.angle * response;
      this.cosines[index] = Math.cos(pose.angle);
      this.sines[index] = Math.sin(pose.angle);
    }
  }

  controlPosition(index: number): readonly [number, number] {
    const control = this.definitions[index], pose = this.poses[index];
    return [control.x + pose.dx, control.y + pose.dy];
  }

  skinPoint(x: number, y: number, z: number, weights: ArrayLike<number>, target: Float32Array, offset: number, weightOffset = 0) {
    let skinnedX = 0, skinnedY = 0;
    for (let index = 0; index < controlDefinitions.length; index++) {
      const weight = weights[weightOffset + index];
      const control = this.definitions[index], pose = this.poses[index];
      const localX = x - control.x, localY = y - control.y;
      const cos = this.cosines[index], sin = this.sines[index];
      skinnedX += weight * (control.x + pose.dx + cos * localX - sin * localY);
      skinnedY += weight * (control.y + pose.dy + sin * localX + cos * localY);
    }
    target[offset] = skinnedX;
    target[offset + 1] = skinnedY;
    target[offset + 2] = z;
  }
}
