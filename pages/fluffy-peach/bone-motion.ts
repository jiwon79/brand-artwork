import { boneDefinitionsFor, neutralBonePose, type BonePose } from './bone-rig';
import { boneChannels, fittedBoneTracks, sampleBoneTracks, setBoneKey, type BoneTracks } from './bone-animation';
import { sampleTrack } from './motion-editor';
import { variants, type VariantId } from './variants';

export const BONE_LOOP_FRAMES = 180;
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
  const u = (frame - SOURCE_END) / (BONE_LOOP_FRAMES - SOURCE_END);
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

export const boneMotionDescriptions: Record<VariantId, string> = {
  original: '측정한 펄럭임 → 시차를 둔 복귀',
  bean: '몸통을 타고 흐르는 굽힘과 양 끝의 탄성',
  flower: '꽃잎을 차례로 스치는 바람과 뒤따르는 잔떨림',
  star: '여러 팔을 타고 흐르는 큰 펄럭임과 탄성',
  wave: '높낮이가 다른 물결과 늦게 말리는 파도 끝',
};

function legacyVariantPose(shape: Exclude<VariantId, 'original'>, frame: number) {
  const cycle = frame / BONE_LOOP_FRAMES * TAU;
  const phase = 2 * cycle + 0.2 * Math.sin(cycle);
  const definitions = boneDefinitionsFor(shape);
  return definitions.map((bone, index) => {
    const x = bone.x / 105, y = bone.y / 105, theta = Math.atan2(y, x);
    const pulse = Math.sin(phase) + 0.18 * Math.sin(2 * phase + 0.35);
    if (index === 0) return {
      dx: shape === 'wave' ? 5 * Math.sin(phase - 0.25) : 2 * Math.sin(phase),
      dy: 4 * Math.sin(phase - 0.35),
      angle: (shape === 'star' ? 0.035 : 0.02) * Math.sin(phase - 0.25),
    };
    if (shape === 'bean') {
      const bend = Math.sin(phase - 0.48 * x);
      return { dx: 25 * x * pulse + 5 * y * bend,
        dy: -11 * y * pulse + 20 * x * bend, angle: 0.13 * x * bend };
    }
    if (shape === 'flower') {
      const petal = Math.sin(phase - 0.38 * Math.sin(theta));
      const curl = Math.sin(phase - 0.38 * Math.sin(theta) - 0.35);
      const radial = 17 * petal;
      return { dx: x * radial - y * 11 * curl,
        dy: y * radial + x * 11 * curl, angle: 0.12 * curl * Math.cos(2 * theta) };
    }
    if (shape === 'star') {
      const flutter = Math.sin(phase - 0.55 * x);
      const stretch = 15 * Math.sin(phase - 0.25 * y);
      return { dx: x * stretch + 12 * y * flutter,
        dy: y * stretch + 24 * x * flutter,
        angle: 0.18 * x * Math.sin(phase - 0.55 * x - 0.25) };
    }
    const travel = Math.sin(phase - 0.85 * x);
    const crest = Math.max(0, y) * Math.max(0, x);
    return { dx: 8 * x * Math.cos(phase - 0.85 * x) - 19 * crest * travel,
      dy: 25 * travel + 10 * crest * Math.sin(phase - 0.9),
      angle: 0.17 * Math.cos(phase - 0.85 * x) - 0.12 * crest * travel };
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
  const stepsPerFrame = 4, stepsPerLoop = BONE_LOOP_FRAMES * stepsPerFrame;
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

const legacyTimes = () => Array.from({ length: BONE_LOOP_FRAMES / 6 + 1 }, (_, index) => index * 6)
  .concat(SOURCE_END).sort((a, b) => a - b);

export function legacyVariantClip(shape: Exclude<VariantId, 'original'>): BoneTracks {
  const times = legacyTimes(), frames = times.map((frame) => legacyVariantPose(shape, frame));
  frames[frames.length - 1] = structuredClone(frames[0]);
  return tracksFromPoses(times, frames);
}

export function createBoneClips(fitted: readonly (readonly BonePose[])[]): Record<VariantId, BoneTracks> {
  return Object.fromEntries(variants.map(({ id }) => {
    const times = id === 'original' ? legacyTimes()
      : Array.from({ length: BONE_LOOP_FRAMES / 3 + 1 }, (_, index) => index * 3);
    const baked = id === 'original' ? null : bakeVariantPoses(id);
    const frames = times.map((frame) => id === 'original' ? originalPose(frame, fitted) : baked![frame]);
    frames[frames.length - 1] = structuredClone(frames[0]);
    return [id, tracksFromPoses(times, frames)];
  })) as Record<VariantId, BoneTracks>;
}

export const VARIANT_MOTION_REVISION = 2;
export function upgradeVariantEdits(saved: BoneTracks, shape: VariantId, next: BoneTracks, revision?: number) {
  if (shape === 'original' || revision === VARIANT_MOTION_REVISION) return saved;
  const previous = legacyVariantClip(shape), result = structuredClone(next);
  saved.forEach((bone, index) => {
    for (const channel of boneChannels) {
      const times = [...new Set(bone[channel].concat(previous[index][channel], next[index][channel]).map((key) => key.frame))];
      for (const frame of times) {
        const offset = sampleTrack(bone[channel], frame, BONE_LOOP_FRAMES) - sampleTrack(previous[index][channel], frame, BONE_LOOP_FRAMES);
        if (Math.abs(offset) < 0.0001) continue;
        setBoneKey(result, index, channel, frame, sampleTrack(next[index][channel], frame, BONE_LOOP_FRAMES) + offset, BONE_LOOP_FRAMES);
      }
    }
  });
  return result;
}

// Keep authored offsets from the previous original rig while replacing its
// mirrored default performance. The old localStorage entry stays untouched.
export function migrateOriginalEdits(saved: BoneTracks, fitted: readonly (readonly BonePose[])[], next: BoneTracks) {
  const previousDefaults = fittedBoneTracks(fitted);
  const previousPeriod = (fitted.length - 1) * 2;
  const result = structuredClone(next);
  saved.forEach((bone, index) => {
    for (const channel of boneChannels) {
      const times = [...new Set(bone[channel].concat(previousDefaults[index][channel]).map((key) => key.frame))].sort((a, b) => a - b);
      for (const at of times) {
        const previous = sampleTrack(previousDefaults[index][channel], at, previousPeriod);
        const offset = sampleTrack(bone[channel], at, previousPeriod) - previous;
        if (Math.abs(offset) < 0.0001) continue;
        const frame = at <= SOURCE_END ? at : Math.round(SOURCE_END
          + (at - SOURCE_END) / (previousPeriod - SOURCE_END) * (BONE_LOOP_FRAMES - SOURCE_END));
        const value = sampleTrack(next[index][channel], frame, BONE_LOOP_FRAMES) + offset;
        setBoneKey(result, index, channel, frame, value, BONE_LOOP_FRAMES);
      }
    }
  });
  return result;
}

export function sampleDefaultPose(clips: Record<VariantId, BoneTracks>, shape: VariantId, frame: number) {
  return sampleBoneTracks(clips[shape], frame, BONE_LOOP_FRAMES);
}
