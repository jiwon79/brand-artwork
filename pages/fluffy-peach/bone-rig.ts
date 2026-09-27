// Thirteen planar controls: a central body bone and twelve around the rim.
// Every surface point blends rigid transforms from nearby controls.
export const boneDefinitions = [
  { name: '몸통 중심', x: 0, y: 0 },
  ...['오른쪽', '오른쪽 아래', '아래 오른쪽', '아래', '아래 왼쪽', '왼쪽 아래',
    '왼쪽', '왼쪽 위', '위 왼쪽', '위', '위 오른쪽', '오른쪽 위'].map((name, index) => {
    const angle = -index * Math.PI / 6;
    return { name, x: 105 * Math.cos(angle), y: 105 * Math.sin(angle) };
  }),
];
export type BonePose = { dx: number; dy: number; angle: number };
export const neutralBonePose = (): BonePose[] => boneDefinitions.map(() => ({ dx: 0, dy: 0, angle: 0 }));

export class BoneRig {
  readonly poses = neutralBonePose();
  private readonly cosines = new Float32Array(boneDefinitions.length).fill(1);
  private readonly sines = new Float32Array(boneDefinitions.length);

  weightsFor(x: number, y: number) {
    const weights = new Float32Array(boneDefinitions.length);
    weights[0] = 1.8 * Math.exp(-(x * x + y * y) / (2 * 68 ** 2));
    let total = weights[0];
    for (let index = 1; index < boneDefinitions.length; index++) {
      const bone = boneDefinitions[index];
      const distance = (x - bone.x) ** 2 + (y - bone.y) ** 2;
      const weight = Math.exp(-distance / (2 * 43 ** 2));
      weights[index] = weight;
      total += weight;
    }
    for (let index = 0; index < weights.length; index++) weights[index] /= total;
    return weights;
  }

  setPose(poses: readonly BonePose[], response = 1) {
    for (let index = 0; index < this.poses.length; index++) {
      const source = poses[index], pose = this.poses[index];
      pose.dx = source.dx * response;
      pose.dy = source.dy * response;
      pose.angle = source.angle * response;
      this.cosines[index] = Math.cos(pose.angle);
      this.sines[index] = Math.sin(pose.angle);
    }
  }

  jointPosition(index: number): readonly [number, number] {
    const bone = boneDefinitions[index], pose = this.poses[index];
    return [bone.x + pose.dx, bone.y + pose.dy];
  }

  skinPoint(x: number, y: number, z: number, weights: ArrayLike<number>, target: Float32Array, offset: number, weightOffset = 0) {
    let skinnedX = 0, skinnedY = 0;
    for (let index = 0; index < boneDefinitions.length; index++) {
      const weight = weights[weightOffset + index];
      const bone = boneDefinitions[index], pose = this.poses[index];
      const localX = x - bone.x, localY = y - bone.y;
      const cos = this.cosines[index], sin = this.sines[index];
      skinnedX += weight * (bone.x + pose.dx + cos * localX - sin * localY);
      skinnedY += weight * (bone.y + pose.dy + sin * localX + cos * localY);
    }
    target[offset] = skinnedX;
    target[offset + 1] = skinnedY;
    target[offset + 2] = z;
  }
}
