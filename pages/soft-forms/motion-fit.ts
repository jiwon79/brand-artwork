import { DeformationRig, controlDefinitions, neutralControlPose, type ControlPose } from './deformation-rig';
import { loopFrame } from './motion-loop';
import { MOTION_FPS, motionPeriod, sampleTrack, type Keyframe } from './motion-track';

export const controlChannels = ['dx', 'dy', 'angle'] as const;
export type ControlChannel = typeof controlChannels[number];
export type ControlTracks = Record<ControlChannel, Keyframe[]>[];
const RADIANS = Math.PI / 180;

export function referenceRadius(x: number, y: number, radii: ArrayLike<number>, baseline: ArrayLike<number>) {
  const mean = (values: ArrayLike<number>) => Array.from(values).reduce((a, b) => a + b, 0) / values.length;
  const baselineMean = mean(baseline), currentMean = mean(radii);
  const theta = (Math.atan2(-y, x) + Math.PI * 2) % (Math.PI * 2);
  const sample = theta * baseline.length / (Math.PI * 2) - 0.5;
  const first = ((Math.floor(sample) % baseline.length) + baseline.length) % baseline.length;
  const fraction = sample - Math.floor(sample);
  const t = Math.max(0, Math.min(1, (-x - 0.3) / 0.65));
  const expansion = 0.94 + t * t * (3 - 2 * t) * 0.1;
  const interpolate = (values: ArrayLike<number>) => (values[first] * (1 - fraction) + values[(first + 1) % values.length] * fraction) * expansion;
  const rest = interpolate(baseline), contour = interpolate(radii);
  const blend = Math.pow(Math.min(1, Math.hypot(x, y)), 0.7);
  return baselineMean + 1.13 * (currentMean - baselineMean)
    + blend * (rest - baselineMean + 1.13 * (contour - rest - (currentMean - baselineMean)));
}

// The constant, regularized least-squares system fits translations and small
// rotations to the original surface. Exact rigid skinning is evaluated between
// correction passes, rather than fitting only four averaged directions.
export function fitControlFrames(contourFrames: readonly (readonly number[])[]) {
  const baseline = contourFrames[0].map((_, index) => contourFrames.reduce((sum, row) => sum + row[index], 0) / contourFrames.length);
  const rig = new DeformationRig();
  const samples = [0.25, 0.5, 0.75, 1].flatMap((ring) => Array.from({ length: 64 }, (_, index) => {
    const angle = -(index + 0.5) * Math.PI * 2 / 64;
    const x = Math.cos(angle) * ring, y = Math.sin(angle) * ring;
    const radius = referenceRadius(x, y, baseline, baseline);
    const restX = x * radius, restY = y * radius;
    return { x, y, restX, restY, weights: rig.weightsFor(restX, restY), importance: ring === 1 ? 2 : 1 };
  }));
  const size = controlDefinitions.length * 3;
  const rows = samples.flatMap((sample) => [0, 1].map((axis) => {
    const row = new Float64Array(size);
    for (let control = 0; control < controlDefinitions.length; control++) {
      const weight = sample.weights[control] * sample.importance;
      row[control * 3 + axis] = weight;
      row[control * 3 + 2] = weight * RADIANS * (axis === 0
        ? -(sample.restY - controlDefinitions[control].y) : sample.restX - controlDefinitions[control].x);
    }
    return row;
  }));
  const normal = Array.from({ length: size }, () => new Float64Array(size));
  for (let i = 0; i < size; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (const row of rows) sum += row[i] * row[j];
      normal[i][j] = normal[j][i] = sum;
    }
    normal[i][i] += i % 3 === 2 ? 0.8 : 0.015;
  }
  const lower = Array.from({ length: size }, () => new Float64Array(size));
  for (let i = 0; i < size; i++) for (let j = 0; j <= i; j++) {
    let value = normal[i][j];
    for (let k = 0; k < j; k++) value -= lower[i][k] * lower[j][k];
    lower[i][j] = i === j ? Math.sqrt(value) : value / lower[j][j];
  }
  const solve = (rhs: Float64Array) => {
    const result = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      let value = rhs[i];
      for (let j = 0; j < i; j++) value -= lower[i][j] * result[j];
      result[i] = value / lower[i][i];
    }
    for (let i = size - 1; i >= 0; i--) {
      let value = result[i];
      for (let j = i + 1; j < size; j++) value -= lower[j][i] * result[j];
      result[i] = value / lower[i][i];
    }
    return result;
  };
  const output = new Float32Array(3);
  return contourFrames.map((radii) => {
    const pose = neutralControlPose();
    for (let pass = 0; pass < 3; pass++) {
      rig.setPose(pose);
      const rhs = new Float64Array(size);
      samples.forEach((sample, index) => {
        const targetRadius = referenceRadius(sample.x, sample.y, radii, baseline);
        rig.skinPoint(sample.restX, sample.restY, 0, sample.weights, output, 0);
        const errorX = (sample.x * targetRadius - output[0]) * sample.importance;
        const errorY = (sample.y * targetRadius - output[1]) * sample.importance;
        for (let parameter = 0; parameter < size; parameter++) {
          rhs[parameter] += rows[index * 2][parameter] * errorX + rows[index * 2 + 1][parameter] * errorY;
        }
      });
      // Penalize accumulated values too, keeping the solution stable in regions
      // where several neighboring controls can explain the same deformation.
      for (let control = 0; control < pose.length; control++) {
        rhs[control * 3] -= 0.015 * pose[control].dx;
        rhs[control * 3 + 1] -= 0.015 * pose[control].dy;
        rhs[control * 3 + 2] -= 0.8 * pose[control].angle / RADIANS;
      }
      const delta = solve(rhs);
      for (let control = 0; control < pose.length; control++) {
        pose[control].dx += delta[control * 3];
        pose[control].dy += delta[control * 3 + 1];
        pose[control].angle += delta[control * 3 + 2] * RADIANS;
      }
    }
    return pose;
  });
}

export function fittedControlTracks(frames: readonly (readonly ControlPose[])[]): ControlTracks {
  const period = motionPeriod(frames.length);
  const positions = Array.from({ length: Math.ceil(period / 6) }, (_, index) => index * 6).concat(period);
  return controlDefinitions.map((_, control) => Object.fromEntries(controlChannels.map((channel) => [channel,
    positions.map((frame) => {
      const source = loopFrame(frame / MOTION_FPS, frames.length);
      const a = Math.floor(source), b = Math.min(a + 1, frames.length - 1), fraction = source - a;
      const value = frames[a][control][channel] * (1 - fraction) + frames[b][control][channel] * fraction;
      return { frame, value: value / (channel === 'angle' ? RADIANS : 1) };
    }),
  ])) as Record<ControlChannel, Keyframe[]>);
}

export function sampleControlTracks(tracks: ControlTracks, frame: number, period: number): ControlPose[] {
  return tracks.map((control) => ({
    dx: sampleTrack(control.dx, frame, period),
    dy: sampleTrack(control.dy, frame, period),
    angle: sampleTrack(control.angle, frame, period) * RADIANS,
  }));
}
