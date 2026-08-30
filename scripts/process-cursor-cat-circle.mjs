import { mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const FRAME_WIDTH = 576;
const FRAME_HEIGHT = 1024;
const RGB_CHANNELS = 3;
const RGB_BUFFER_SIZE = FRAME_WIDTH * FRAME_HEIGHT * RGB_CHANNELS;

const RIGHT_POSE_FRAMES = [
  1, 4, 7, 11, 14, 17, 20, 23, 26, 30,
  33, 36, 39, 42, 45, 49, 52, 55, 58, 61,
  64, 68, 71, 74, 77, 80, 83, 87, 90, 93, 96,
];

// Seedance holds the top pose at the start of this clip, rotates most quickly
// through the middle, then settles into the left pose. These native indices
// represent equal three-degree gaze steps rather than equal time steps.
const LEFT_POSE_FRAMES = [
  16, 20, 23, 25, 27, 28, 29, 31, 32, 33,
  34, 36, 37, 38, 40, 41, 43, 44, 46, 48,
  50, 52, 54, 56, 59, 61, 65, 71, 81,
];

function parseOptions(argv) {
  const options = {};
  const args = argv.filter((argument) => argument !== '--');

  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error(`Invalid option: ${key ?? ''}`);
    options[key.slice(2)] = value;
  }

  for (const required of ['right-video', 'left-video', 'output']) {
    if (!options[required]) throw new Error(`Missing --${required}`);
  }

  return options;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: Object.hasOwn(options, 'encoding') ? options.encoding : 'utf8',
    input: options.input,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    const error = result.stderr?.toString() || result.stdout?.toString();
    throw new Error(`${command} failed:\n${error}`);
  }

  return result.stdout;
}

function extractFrame(video, sourceFrame, output) {
  mkdirSync(dirname(output), { recursive: true });
  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-i', video,
    '-vf', `select=eq(n\\,${sourceFrame - 1}),scale=${FRAME_WIDTH}:${FRAME_HEIGHT}:force_original_aspect_ratio=increase,crop=${FRAME_WIDTH}:${FRAME_HEIGHT}`,
    '-frames:v', '1',
    '-y', output,
  ]);
}

function decodeRgb(input) {
  const rgb = run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-i', input,
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    'pipe:1',
  ], { encoding: null });

  if (rgb.length !== RGB_BUFFER_SIZE) {
    throw new Error(`Unexpected decoded size for ${input}: ${rgb.length}`);
  }

  return rgb;
}

function encodeWebp(rgb, output) {
  const png = join(temporaryDirectory, `graded-${basename(output, '.webp')}.png`);
  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    '-s:v', `${FRAME_WIDTH}x${FRAME_HEIGHT}`,
    '-i', 'pipe:0',
    '-frames:v', '1',
    '-y', png,
  ], { encoding: null, input: rgb });
  run('cwebp', ['-quiet', '-q', '85', '-m', '6', '-sharp_yuv', png, '-o', output]);
}

function measureTone(rgb) {
  const orange = { count: 0, luma: 0, saturation: 0 };
  const white = { count: 0, luma: 0, red: 0, green: 0, blue: 0 };

  for (let offset = 0; offset < rgb.length; offset += RGB_CHANNELS) {
    const red = rgb[offset];
    const green = rgb[offset + 1];
    const blue = rgb[offset + 2];
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const saturation = maximum === 0 ? 0 : (maximum - minimum) / maximum;
    const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;

    // The orange coat gives a stable saturation/midtone sample even while the
    // head rotates. Very dark eye and nose pixels are excluded.
    if (red > green * 1.06 && green > blue * 0.95 && luma > 35 && luma < 235 && saturation > 0.1) {
      orange.count += 1;
      orange.luma += luma;
      orange.saturation += saturation;
    }

    // Near-neutral pixels below the white background measure the white coat.
    if (saturation < 0.1 && luma > 150 && luma < 246) {
      white.count += 1;
      white.luma += luma;
      white.red += red;
      white.green += green;
      white.blue += blue;
    }
  }

  if (orange.count === 0 || white.count === 0) {
    throw new Error('Could not measure both orange and white fur samples');
  }

  return {
    orangeLuma: orange.luma / orange.count,
    orangeSaturation: orange.saturation / orange.count,
    whiteLuma: white.luma / white.count,
    whiteRed: white.red / white.count,
    whiteGreen: white.green / white.count,
    whiteBlue: white.blue / white.count,
  };
}

function buildToneProfile(sourceTone, targetTone) {
  return {
    sourceOrangeLuma: sourceTone.orangeLuma,
    targetOrangeLuma: targetTone.orangeLuma,
    sourceWhiteLuma: sourceTone.whiteLuma,
    targetWhiteLuma: targetTone.whiteLuma,
    saturation: targetTone.orangeSaturation / sourceTone.orangeSaturation,
    redBalance: (targetTone.whiteRed - targetTone.whiteGreen)
      - (sourceTone.whiteRed - sourceTone.whiteGreen),
    blueBalance: (targetTone.whiteBlue - targetTone.whiteGreen)
      - (sourceTone.whiteBlue - sourceTone.whiteGreen),
  };
}

function interpolate(start, end, progress) {
  const profile = {};
  for (const key of Object.keys(start)) {
    profile[key] = start[key] + (end[key] - start[key]) * progress;
  }
  return profile;
}

function mapLuma(luma, profile) {
  const sourceKnots = [0, profile.sourceOrangeLuma, profile.sourceWhiteLuma, 255];
  const targetKnots = [0, profile.targetOrangeLuma, profile.targetWhiteLuma, 255];

  let segment = 0;
  while (segment < sourceKnots.length - 2 && luma > sourceKnots[segment + 1]) {
    segment += 1;
  }

  const sourceRange = sourceKnots[segment + 1] - sourceKnots[segment];
  const progress = sourceRange === 0 ? 0 : (luma - sourceKnots[segment]) / sourceRange;
  return targetKnots[segment] + (targetKnots[segment + 1] - targetKnots[segment]) * progress;
}

function smoothstep(start, end, value) {
  const progress = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return progress * progress * (3 - 2 * progress);
}

function clampChannel(value) {
  return Math.round(Math.max(0, Math.min(255, value)));
}

function applyToneProfile(source, profile) {
  const output = Buffer.allocUnsafe(source.length);

  for (let offset = 0; offset < source.length; offset += RGB_CHANNELS) {
    const red = source[offset];
    const green = source[offset + 1];
    const blue = source[offset + 2];
    const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    const targetLuma = mapLuma(luma, profile);
    const lumaShift = targetLuma - luma;

    const gradedRed = luma + (red - luma) * profile.saturation + lumaShift + profile.redBalance;
    const gradedGreen = luma + (green - luma) * profile.saturation + lumaShift;
    const gradedBlue = luma + (blue - luma) * profile.saturation + lumaShift + profile.blueBalance;

    // Keep the pure white canvas untouched and feather the correction into
    // pale fur/antialiased edges rather than tinting the background.
    const foreground = smoothstep(3, 16, 255 - Math.min(red, green, blue));
    output[offset] = clampChannel(red + (gradedRed - red) * foreground);
    output[offset + 1] = clampChannel(green + (gradedGreen - green) * foreground);
    output[offset + 2] = clampChannel(blue + (gradedBlue - blue) * foreground);
  }

  return output;
}

function matchTone(source, targetTone) {
  const sourceTone = measureTone(source);
  const profile = buildToneProfile(sourceTone, targetTone);

  // The coat sample spans both sides of the piecewise luma curve, and the
  // foreground feather softens the correction on pale fur. Refine against
  // the measured result so the encoded sequence follows the smooth target
  // tone rather than the video model's frame-to-frame exposure drift.
  for (let pass = 0; pass < 3; pass += 1) {
    const gradedTone = measureTone(applyToneProfile(source, profile));
    profile.targetOrangeLuma += targetTone.orangeLuma - gradedTone.orangeLuma;
    profile.targetWhiteLuma += targetTone.whiteLuma - gradedTone.whiteLuma;
    profile.saturation *= targetTone.orangeSaturation / gradedTone.orangeSaturation;
    profile.redBalance += (targetTone.whiteRed - targetTone.whiteGreen)
      - (gradedTone.whiteRed - gradedTone.whiteGreen);
    profile.blueBalance += (targetTone.whiteBlue - targetTone.whiteGreen)
      - (gradedTone.whiteBlue - gradedTone.whiteGreen);
  }

  return { graded: applyToneProfile(source, profile), profile };
}

function describeProfile(label, profile) {
  const orangeLift = profile.targetOrangeLuma - profile.sourceOrangeLuma;
  const whiteLift = profile.targetWhiteLuma - profile.sourceWhiteLuma;
  console.log(
    `${label}: orange ${orangeLift >= 0 ? '+' : ''}${orangeLift.toFixed(1)}, `
    + `white ${whiteLift >= 0 ? '+' : ''}${whiteLift.toFixed(1)}, `
    + `saturation ${profile.saturation.toFixed(3)}, `
    + `white balance R ${profile.redBalance >= 0 ? '+' : ''}${profile.redBalance.toFixed(1)} / `
    + `B ${profile.blueBalance >= 0 ? '+' : ''}${profile.blueBalance.toFixed(1)}`,
  );
}

const options = parseOptions(process.argv.slice(2));
const rightVideo = resolve(options['right-video']);
const leftVideo = resolve(options['left-video']);
const outputDirectory = resolve(options.output);
const temporaryDirectory = resolve('.qa/cursor-cat-circle-processing');

mkdirSync(outputDirectory, { recursive: true });
mkdirSync(temporaryDirectory, { recursive: true });

const canonicalRight = decodeRgb(join(outputDirectory, 'frame-001.webp'));
const canonicalTop = decodeRgb(join(outputDirectory, 'frame-031.webp'));
const canonicalLeft = decodeRgb(join(outputDirectory, 'frame-061.webp'));
const rightTone = measureTone(canonicalRight);
const topTone = measureTone(canonicalTop);
const leftTone = measureTone(canonicalLeft);

// Keep frames 001, 031, and 061 as their approved canonical endpoint assets.
for (let index = 1; index < RIGHT_POSE_FRAMES.length - 1; index += 1) {
  const runtimeFrame = index + 1;
  const sourceFrame = RIGHT_POSE_FRAMES[index];
  const png = join(temporaryDirectory, `right-${String(sourceFrame).padStart(3, '0')}.png`);
  const webp = join(outputDirectory, `frame-${String(runtimeFrame).padStart(3, '0')}.webp`);
  extractFrame(rightVideo, sourceFrame, png);
  const source = decodeRgb(png);
  const targetTone = interpolate(rightTone, topTone, index / 30);
  const { graded, profile } = matchTone(source, targetTone);
  if (index === 1 || index === RIGHT_POSE_FRAMES.length - 2) {
    describeProfile(`frame ${String(runtimeFrame).padStart(3, '0')}`, profile);
  }
  encodeWebp(graded, webp);
}

for (let index = 0; index < LEFT_POSE_FRAMES.length; index += 1) {
  const runtimeFrame = index + 32;
  const sourceFrame = LEFT_POSE_FRAMES[index];
  const png = join(temporaryDirectory, `left-${String(sourceFrame).padStart(3, '0')}.png`);
  const webp = join(outputDirectory, `frame-${String(runtimeFrame).padStart(3, '0')}.webp`);
  extractFrame(leftVideo, sourceFrame, png);
  const source = decodeRgb(png);
  const targetTone = interpolate(topTone, leftTone, (index + 1) / 30);
  const { graded, profile } = matchTone(source, targetTone);
  if (index === 0 || index === LEFT_POSE_FRAMES.length - 1) {
    describeProfile(`frame ${String(runtimeFrame).padStart(3, '0')}`, profile);
  }
  encodeWebp(graded, webp);
}

console.log(`Rebuilt and tone-matched 58 calibrated intermediate frames in ${outputDirectory}`);
