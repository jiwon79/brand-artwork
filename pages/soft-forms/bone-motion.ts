import { boneDefinitionsFor, neutralBonePose, type BonePose } from './bone-rig';
import { boneChannels, sampleBoneTracks, type BoneTracks } from './bone-animation';
import { variants, type VariantId } from './variants';

export const BONE_LOOP_FRAMES = 144;
export const PREVIOUS_BONE_LOOP_FRAMES = 180;
export const SOURCE_END = 119;
const TAU = Math.PI * 2;
const radians = Math.PI / 180;
export const smooth = (x: number) => {
  const u = Math.max(0, Math.min(1, x));
  return u * u * u * (u * (u * 6 - 15) + 10);
};
export function cycleFrame(frame: number) {
  return ((frame % BONE_LOOP_FRAMES) + BONE_LOOP_FRAMES) % BONE_LOOP_FRAMES;
}
// Only the forward performance is sampled. Recovery is a new pose trajectory.
export function forwardFrame(frame: number) {
  const at = Math.max(0, Math.min(SOURCE_END, frame));
  const ease = (distance: number) => {
    const t = distance / 8;
    return 8 * (2 * t * t - t * t * t);
  };
  if (at < 8) return ease(at);
  if (at > SOURCE_END - 8) return SOURCE_END - ease(SOURCE_END - at);
  return at;
}

function originalPose(frame: number, fitted: readonly (readonly BonePose[])[]) {
  if (frame <= SOURCE_END) {
    const source = forwardFrame(frame), first = Math.floor(source);
    const fraction = source - first, next = Math.min(first + 1, SOURCE_END);
    return fitted[first].map((bone, index) => ({
      dx: bone.dx + (fitted[next][index].dx - bone.dx) * fraction,
      dy: bone.dy + (fitted[next][index].dy - bone.dy) * fraction,
      angle: bone.angle + (fitted[next][index].angle - bone.angle) * fraction,
    }));
  }
  const u = (frame - SOURCE_END) / (PREVIOUS_BONE_LOOP_FRAMES - SOURCE_END);
  return fitted[SOURCE_END].map((bone, index) => {
    const definition = boneDefinitionsFor('original')[index];
    const theta = Math.atan2(definition.y, definition.x);
    // The rim follows the center with spatially staggered settling and a small
    // curved follow-through, instead of replaying every flutter in reverse.
    const lag = index === 0 ? 0 : 0.13 * Math.cos(theta + 0.5);
    const recovery = smooth(u + lag * Math.sin(Math.PI * u) ** 2);
    const arc = Math.sin(Math.PI * u) ** 2 * Math.sin(TAU * u);
    const first = fitted[0][index];
    return {
      dx: bone.dx + (first.dx - bone.dx) * recovery + (index ? 7 * Math.sin(theta) : 0) * arc,
      dy: bone.dy + (first.dy - bone.dy) * recovery + (index ? 9 * Math.cos(theta) : 2) * arc,
      angle: bone.angle + (first.angle - bone.angle) * recovery + (index ? 0.07 * Math.cos(theta) : 0.02) * arc,
    };
  });
}

// Three connected gusts have different lengths and strengths. Every channel
// follows this same wind field; the rim responds later than the body.
function wind(time: number) {
  const pulse = (center: number, width: number) =>
    Math.exp(-0.5 * (Math.sin(Math.PI * (time - center)) / (Math.PI * width)) ** 2);
  return 1.1 * pulse(0.12, 0.029) - 0.62 * pulse(0.215, 0.045)
    + 0.88 * pulse(0.43, 0.054) - 0.48 * pulse(0.565, 0.058)
    + 1.18 * pulse(0.76, 0.033) - 0.66 * pulse(0.86, 0.052);
}

function windTarget(shape: Exclude<VariantId, 'original'>, time: number, x: number, y: number, index: number): BonePose {
  const delay = shape === 'wave' ? 0.10 * x
    : shape === 'star' ? 0.075 * x - 0.025 * y : 0.06 * x + 0.025 * y;
  const flow = wind(time - delay), follow = wind(time - delay - 0.035);
  if (index === 0) return { dx: 5 * flow, dy: 7 * follow, angle: 0.025 * follow };
  if (shape === 'bean') {
    const stretch = 0.6 * flow + 0.4 * follow;
    return { dx: 30 * x * stretch + 10 * y * flow,
      dy: -13 * y * stretch + 30 * x * flow + 8 * (x * x - 0.5) * follow,
      angle: 0.20 * x * follow - 0.07 * y * flow };
  }
  if (shape === 'flower') {
    const radial = 23 * flow, curl = 21 * follow;
    return { dx: x * radial - y * curl + 7 * flow,
      dy: y * radial + x * curl,
      angle: 0.27 * Math.sin(2 * Math.atan2(y, x)) * follow };
  }
  if (shape === 'star') return {
    dx: 22 * x * flow + 16 * y * follow,
    dy: 12 * y * flow + 42 * x * flow + 12 * follow,
    angle: 0.30 * x * follow - 0.12 * y * flow,
  };
  const crest = Math.max(0, y) * Math.max(0, x);
  return { dx: 10 * x * flow - 35 * crest * follow - 5 * y * follow,
    dy: 34 * flow + 14 * crest * follow,
    angle: 0.24 * follow - 0.24 * crest * flow };
}

function bakeVariantPoses(shape: Exclude<VariantId, 'original'>) {
  const definitions = boneDefinitionsFor(shape);
  const positions = neutralBonePose(), velocities = neutralBonePose();
  const stepsPerFrame = 4, stepsPerLoop = PREVIOUS_BONE_LOOP_FRAMES * stepsPerFrame;
  const dt = 1 / (24 * stepsPerFrame);
  const frames: BonePose[][] = [];
  // Warm up complete cycles so the saved spring state is already periodic.
  for (let step = 0; step <= stepsPerLoop * 4; step++) {
    const time = step / stepsPerLoop;
    definitions.forEach((bone, index) => {
      const x = bone.x / 105, y = bone.y / 105;
      const target = windTarget(shape, time, x, y, index);
      const strength = index === 0 ? 1.15 : 1.45;
      const frequency = TAU * (index === 0 ? 1.8 : 2.6 - 0.4 * Math.max(0, y));
      const damping = index === 0 ? 0.78 : 0.57;
      for (const channel of boneChannels) {
        const acceleration = frequency * frequency * (strength * target[channel] - positions[index][channel])
          - 2 * damping * frequency * velocities[index][channel];
        velocities[index][channel] += acceleration * dt;
        positions[index][channel] += velocities[index][channel] * dt;
      }
    });
    if (step >= stepsPerLoop * 3 && step % stepsPerFrame === 0) frames.push(structuredClone(positions));
  }
  frames[frames.length - 1] = structuredClone(frames[0]);
  return frames;
}

function tracksFromPoses(times: number[], frames: readonly (readonly BonePose[])[]): BoneTracks {
  return neutralBonePose().map((_, bone) => Object.fromEntries(boneChannels.map((channel) => [channel,
    times.map((frame, index) => ({ frame, value: frames[index][bone][channel] / (channel === 'angle' ? radians : 1) })),
  ])) as BoneTracks[number]);
}

const legacyTimes = () => Array.from({ length: PREVIOUS_BONE_LOOP_FRAMES / 6 + 1 }, (_, index) => index * 6)
  .concat(SOURCE_END).sort((a, b) => a - b);

function createPreviousClips(fitted: readonly (readonly BonePose[])[]): Record<VariantId, BoneTracks> {
  return Object.fromEntries(variants.map(({ id }) => {
    const times = id === 'original' ? legacyTimes()
      : Array.from({ length: PREVIOUS_BONE_LOOP_FRAMES / 3 + 1 }, (_, index) => index * 3);
    const baked = id === 'original' ? null : bakeVariantPoses(id);
    const frames = times.map((frame) => id === 'original' ? originalPose(frame, fitted) : baked![frame]);
    frames[frames.length - 1] = structuredClone(frames[0]);
    return [id, tracksFromPoses(times, frames)];
  })) as Record<VariantId, BoneTracks>;
}

export type BoneTimeMap = { oldAtNew: (frame: number) => number; newAtOld: (frame: number) => number };

function originalTimeMap(): BoneTimeMap {
  // Keep the first 88 recorded frames at their original pace. The late
  // near-still portion of the forward performance and the settling tail shrink.
  const old = [0, 88, SOURCE_END, PREVIOUS_BONE_LOOP_FRAMES];
  const next = [0, 88, 96, BONE_LOOP_FRAMES];
  const convert = (value: number, from: number[], to: number[]) => {
    const at = Math.max(0, Math.min(from[from.length - 1], value));
    const index = Math.min(from.length - 2, from.findIndex((end, index) => index > 0 && at <= end) - 1);
    return to[index] + (at - from[index]) / (from[index + 1] - from[index]) * (to[index + 1] - to[index]);
  };
  return { oldAtNew: (frame) => convert(frame, next, old), newAtOld: (frame) => convert(frame, old, next) };
}

function variantTimeMap(tracks: BoneTracks): BoneTimeMap {
  const period = PREVIOUS_BONE_LOOP_FRAMES;
  const activity = Array.from({ length: period }, (_, frame) => {
    const first = sampleBoneTracks(tracks, frame, period), second = sampleBoneTracks(tracks, frame + 1, period);
    return Math.sqrt(first.reduce((sum, bone, index) => sum
      + (second[index].dx - bone.dx) ** 2 + (second[index].dy - bone.dy) ** 2
      + ((second[index].angle - bone.angle) * 70) ** 2, 0) / first.length);
  });
  // Smooth activity around the seam so the time map does not introduce a beat.
  const smoothed = activity.map((_, index) => {
    let total = 0, weight = 0;
    for (let offset = -4; offset <= 4; offset++) {
      const influence = 5 - Math.abs(offset);
      total += activity[(index + offset + period) % period] * influence;
      weight += influence;
    }
    return total / weight;
  });
  const duration = (speed: number, threshold: number) => Math.min(1, Math.max(0.28, speed / threshold));
  let low = 0.000001, high = Math.max(...smoothed) * 5;
  for (let attempt = 0; attempt < 36; attempt++) {
    const middle = (low + high) / 2;
    if (smoothed.reduce((sum, speed) => sum + duration(speed, middle), 0) > BONE_LOOP_FRAMES) low = middle;
    else high = middle;
  }
  const cumulative = [0];
  for (const speed of smoothed) cumulative.push(cumulative[cumulative.length - 1] + duration(speed, high));
  const scale = BONE_LOOP_FRAMES / cumulative[period];
  for (let index = 1; index <= period; index++) cumulative[index] *= scale;
  cumulative[period] = BONE_LOOP_FRAMES;
  return {
    newAtOld: (frame) => {
      const at = Math.max(0, Math.min(period, frame)), index = Math.min(period - 1, Math.floor(at));
      return cumulative[index] + (at - index) * (cumulative[index + 1] - cumulative[index]);
    },
    oldAtNew: (frame) => {
      const at = Math.max(0, Math.min(BONE_LOOP_FRAMES, frame));
      let low = 0, high = period;
      while (high - low > 1) {
        const middle = (low + high) >> 1;
        if (cumulative[middle] < at) low = middle; else high = middle;
      }
      return low + (at - cumulative[low]) / (cumulative[low + 1] - cumulative[low]);
    },
  };
}

export function createBoneMotion(fitted: readonly (readonly BonePose[])[]) {
  const previousClips = createPreviousClips(fitted);
  const timeMaps = Object.fromEntries(variants.map(({ id }) => [id,
    id === 'original' ? originalTimeMap() : variantTimeMap(previousClips[id]),
  ])) as Record<VariantId, BoneTimeMap>;
  const clips = Object.fromEntries(variants.map(({ id }) => {
    const times = Array.from({ length: BONE_LOOP_FRAMES / 3 + 1 }, (_, index) => index * 3);
    const frames = times.map((frame) => sampleBoneTracks(previousClips[id], timeMaps[id].oldAtNew(frame), PREVIOUS_BONE_LOOP_FRAMES));
    frames[frames.length - 1] = structuredClone(frames[0]);
    return [id, tracksFromPoses(times, frames)];
  })) as Record<VariantId, BoneTracks>;
  return { clips, previousClips, timeMaps };
}

export function sampleDefaultPose(clips: Record<VariantId, BoneTracks>, shape: VariantId, frame: number) {
  return sampleBoneTracks(clips[shape], frame, BONE_LOOP_FRAMES);
}
