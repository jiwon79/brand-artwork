import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

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

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'pipe' });
  if (result.status !== 0) {
    throw new Error(`${command} failed:\n${result.stderr || result.stdout}`);
  }
}

function extractFrame(video, sourceFrame, output) {
  mkdirSync(dirname(output), { recursive: true });
  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-i', video,
    '-vf', `select=eq(n\\,${sourceFrame - 1}),scale=576:1024:force_original_aspect_ratio=increase,crop=576:1024`,
    '-frames:v', '1',
    '-y', output,
  ]);
}

function encodeWebp(input, output) {
  run('cwebp', ['-quiet', '-q', '85', '-m', '6', '-sharp_yuv', input, '-o', output]);
}

const options = parseOptions(process.argv.slice(2));
const rightVideo = resolve(options['right-video']);
const leftVideo = resolve(options['left-video']);
const outputDirectory = resolve(options.output);
const temporaryDirectory = resolve('.qa/cursor-cat-circle-processing');

mkdirSync(outputDirectory, { recursive: true });
mkdirSync(temporaryDirectory, { recursive: true });

// Keep frames 001, 031, and 061 as their approved canonical endpoint assets.
for (let index = 1; index < RIGHT_POSE_FRAMES.length - 1; index += 1) {
  const runtimeFrame = index + 1;
  const sourceFrame = RIGHT_POSE_FRAMES[index];
  const png = join(temporaryDirectory, `right-${String(sourceFrame).padStart(3, '0')}.png`);
  const webp = join(outputDirectory, `frame-${String(runtimeFrame).padStart(3, '0')}.webp`);
  extractFrame(rightVideo, sourceFrame, png);
  encodeWebp(png, webp);
}

for (let index = 0; index < LEFT_POSE_FRAMES.length; index += 1) {
  const runtimeFrame = index + 32;
  const sourceFrame = LEFT_POSE_FRAMES[index];
  const png = join(temporaryDirectory, `left-${String(sourceFrame).padStart(3, '0')}.png`);
  const webp = join(outputDirectory, `frame-${String(runtimeFrame).padStart(3, '0')}.webp`);
  extractFrame(leftVideo, sourceFrame, png);
  encodeWebp(png, webp);
}

console.log(`Rebuilt 58 calibrated intermediate frames in ${outputDirectory}`);
