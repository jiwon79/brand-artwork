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
  bean: '몸통이 늘어나며 양 끝이 부드럽게 휘어짐',
  flower: '꽃잎마다 시차를 두고 오므렸다 펼침',
  star: '다섯 팔이 함께 휘고 늘어나며 흐르는 펄럭임',
  wave: '왼쪽에서 오른쪽으로 흐르며 말리는 파도',
};

function variantPose(shape: Exclude<VariantId, 'original'>, frame: number) {
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

export function createBoneClips(fitted: readonly (readonly BonePose[])[]): Record<VariantId, BoneTracks> {
  const times = Array.from({ length: BONE_LOOP_FRAMES / 6 + 1 }, (_, index) => index * 6).concat(SOURCE_END).sort((a, b) => a - b);
  return Object.fromEntries(variants.map(({ id }) => {
    const frames = times.map((frame) => id === 'original' ? originalPose(frame, fitted) : variantPose(id, frame));
    // Explicit identical endpoints avoid accumulating floating-point seam error.
    frames[frames.length - 1] = structuredClone(frames[0]);
    const tracks = neutralBonePose().map((_, bone) => Object.fromEntries(boneChannels.map((channel) => [channel,
      times.map((frame, index) => ({ frame, value: frames[index][bone][channel] / (channel === 'angle' ? radians : 1) })),
    ])) as BoneTracks[number]);
    return [id, tracks];
  })) as Record<VariantId, BoneTracks>;
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

