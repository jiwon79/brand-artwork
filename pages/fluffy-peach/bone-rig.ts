// A small, editable armature for the original character. The rest mesh is
// skinned with normalized envelope weights; one source-frame pose drives all
// joints, so there is no separate procedural oscillator to reset or desync.
export const boneDefinitions = [
  { name: '몸통', x: 0, y: 0 },
  { name: '왼쪽', x: -105, y: 0 },
  { name: '오른쪽', x: 105, y: 0 },
  { name: '위', x: 0, y: 100 },
  { name: '아래', x: 0, y: -100 },
] as const;

type Pose = { dx: number; dy: number; angle: number };
const TWO_PI = Math.PI * 2;
const SAMPLE_COUNT = 64;

function sectorAverage(radii: ArrayLike<number>, targetAngle: number) {
  let sum = 0, total = 0;
  for (let index = 0; index < SAMPLE_COUNT; index++) {
    const angle = -(index + 0.5) * TWO_PI / SAMPLE_COUNT;
    const difference = Math.atan2(Math.sin(angle - targetAngle), Math.cos(angle - targetAngle));
    const weight = Math.exp(-0.5 * (difference / 0.45) ** 2);
    sum += radii[index] * weight;
    total += weight;
  }
  return sum / total;
}

export class BoneRig {
  readonly poses: Pose[] = boneDefinitions.map(() => ({ dx: 0, dy: 0, angle: 0 }));
  private readonly baselineSectors: number[];
  private readonly cosines = new Float32Array(boneDefinitions.length).fill(1);
  private readonly sines = new Float32Array(boneDefinitions.length);

  constructor(baselineRadii: ArrayLike<number>) {
    this.baselineSectors = [Math.PI, 0, Math.PI / 2, -Math.PI / 2]
      .map((angle) => sectorAverage(baselineRadii, angle));
  }

  weightsFor(x: number, y: number) {
    const weights = new Float32Array(boneDefinitions.length);
    weights[0] = 0.7;
    let total = weights[0];
    for (let index = 1; index < boneDefinitions.length; index++) {
      const bone = boneDefinitions[index];
      const distance = (x - bone.x) ** 2 + (y - bone.y) ** 2;
      const weight = Math.exp(-distance / (2 * 76 ** 2));
      weights[index] = weight;
      total += weight;
    }
    for (let index = 0; index < weights.length; index++) weights[index] /= total;
    return weights;
  }

  poseFromRadii(radii: ArrayLike<number>, response: number) {
    const [left, right, top, bottom] = [Math.PI, 0, Math.PI / 2, -Math.PI / 2]
      .map((angle, index) => (sectorAverage(radii, angle) - this.baselineSectors[index]) * response);
    const spread = (left + right) / 2;
    this.poses[0] = { dx: 0, dy: 0, angle: 0 };
    this.poses[1] = { dx: -left * 2.25, dy: top * 0.12, angle: (top - bottom) * 0.0038 };
    this.poses[2] = { dx: right * 2.25, dy: top * 0.10, angle: (top - bottom) * -0.0038 };
    this.poses[3] = { dx: (right - left) * 0.18, dy: top * 1.8 - spread * 1.3, angle: (right - left) * -0.0022 };
    this.poses[4] = { dx: (right - left) * 0.12, dy: -bottom * 1.45 + spread, angle: (right - left) * 0.0015 };
    for (let index = 0; index < this.poses.length; index++) {
      this.cosines[index] = Math.cos(this.poses[index].angle);
      this.sines[index] = Math.sin(this.poses[index].angle);
    }
  }

  jointPosition(index: number): readonly [number, number] {
    const bone = boneDefinitions[index];
    const pose = this.poses[index];
    return [bone.x + pose.dx, bone.y + pose.dy];
  }

  skinPoint(x: number, y: number, z: number, weights: ArrayLike<number>, target: Float32Array, offset: number, weightOffset = 0) {
    let skinnedX = 0, skinnedY = 0;
    for (let index = 0; index < boneDefinitions.length; index++) {
      const weight = weights[weightOffset + index];
      if (weight < 0.0001) continue;
      const bone = boneDefinitions[index];
      const pose = this.poses[index];
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
