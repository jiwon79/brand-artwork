import { controlDefinitions, DeformationRig } from './deformation-rig';
import { restSurface } from './rest-surface';
import type { VariantId } from './variants';

/** Cached rest positions and fixed control weights, rebuilt only when the shape changes. */
export type SurfaceBinding = {
  restPositions: Float32Array;
  controlWeights: Float32Array;
  cheekWeights: Float32Array;
};

export function cheekWeight(shape: VariantId, x: number, y: number, z: number) {
  return shape === 'original' ? Math.max(0, z)
    * Math.exp(-Math.pow((x - 0.71) / 0.26, 2) - Math.pow((y + 0.38) / 0.38, 2)) * 44 : 0;
}

export function bindSurface(
  rig: DeformationRig, directions: ArrayLike<number>, baseline: ArrayLike<number>, stride = 3, inset = 0,
): SurfaceBinding {
  const count = directions.length / stride;
  const restPositions = new Float32Array(count * 3);
  const controlWeights = new Float32Array(count * controlDefinitions.length);
  const cheekWeights = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    const x = directions[index * stride], y = directions[index * stride + 1], z = directions[index * stride + 2];
    const offset = index * 3;
    restSurface(rig.shape, x, y, z, baseline, restPositions, offset);
    // The root uses the body's weights before it is tucked beneath the surface.
    controlWeights.set(rig.weightsFor(restPositions[offset], restPositions[offset + 1]), index * controlDefinitions.length);
    if (inset !== 0) {
      restPositions[offset] -= x * inset;
      restPositions[offset + 1] -= y * inset;
      restPositions[offset + 2] -= z * inset;
    }
    cheekWeights[index] = cheekWeight(rig.shape, x, y, z);
  }
  return { restPositions, controlWeights, cheekWeights };
}

export function skinBoundPoint(
  rig: DeformationRig, binding: SurfaceBinding, index: number, cheekStrength: number,
  target: Float32Array, offset: number,
) {
  const at = index * 3;
  rig.skinPoint(binding.restPositions[at], binding.restPositions[at + 1],
    binding.restPositions[at + 2] + cheekStrength * binding.cheekWeights[index],
    binding.controlWeights, target, offset, index * controlDefinitions.length);
}
