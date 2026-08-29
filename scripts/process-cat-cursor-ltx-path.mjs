import { mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function readOptions(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];

    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid option near ${key ?? 'end of command'}`);
    }

    options[key.slice(2)] = value;
  }

  return options;
}

function requireNumber(value, name, fallback) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} must be a number`);
  return number;
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  if (result.status !== 0) {
    throw new Error(`${command} failed:\n${result.stderr || result.stdout}`);
  }

  return result.stdout.trim();
}

function nativeFrameCount(videoPath) {
  return Number(run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-count_frames',
    '-show_entries', 'stream=nb_read_frames',
    '-of', 'default=nw=1:nk=1',
    videoPath,
  ]));
}

function selectedIndices(sourceCount, poseCount) {
  return Array.from({ length: poseCount }, (_, index) => (
    Math.round(index * (sourceCount - 1) / (poseCount - 1))
  ));
}

function endpointOffset(poseIndex, poseCount, rampFrames, startOffset, endOffset) {
  if (poseIndex <= rampFrames + 1) {
    return startOffset * (rampFrames + 2 - poseIndex) / rampFrames;
  }

  if (poseIndex >= poseCount - rampFrames) {
    return endOffset * (poseIndex - (poseCount - rampFrames - 1)) / rampFrames;
  }

  return 0;
}

function usage() {
  return [
    'Usage:',
    '  pnpm process:cat-cursor-ltx --video <input.mp4> --output <frame-dir> [options]',
    '',
    'Options:',
    '  --poses <count>          Total poses including canonical endpoints (default: 49)',
    '  --start-offset <Y>       Luma correction beside the first endpoint (default: 0)',
    '  --end-offset <Y>         Luma correction beside the last endpoint (default: 0)',
    '  --ramp-frames <count>    Interior frames used for each endpoint ramp (default: 7)',
    '  --quality <0-100>        WebP quality (default: 82)',
  ].join('\n');
}

const options = readOptions(process.argv.slice(2));

if (!options.video || !options.output) {
  throw new Error(usage());
}

const videoPath = resolve(options.video);
const outputPath = resolve(options.output);
const poseCount = requireNumber(options.poses, 'poses', 49);
const startOffset = requireNumber(options['start-offset'], 'start-offset', 0);
const endOffset = requireNumber(options['end-offset'], 'end-offset', 0);
const rampFrames = requireNumber(options['ramp-frames'], 'ramp-frames', 7);
const quality = requireNumber(options.quality, 'quality', 82);

if (!Number.isInteger(poseCount) || poseCount < 3) throw new Error('poses must be an integer of at least 3');
if (!Number.isInteger(rampFrames) || rampFrames < 1 || rampFrames * 2 >= poseCount - 1) {
  throw new Error('ramp-frames must leave at least one uncorrected interior pose');
}

const sourceCount = nativeFrameCount(videoPath);
if (!Number.isInteger(sourceCount) || sourceCount < poseCount) {
  throw new Error(`Video has ${sourceCount} frames, fewer than the requested ${poseCount} poses`);
}

const indices = selectedIndices(sourceCount, poseCount);
const selectExpression = indices.map((index) => `eq(n\\,${index})`).join('+');
const temporaryPath = mkdtempSync(join(tmpdir(), 'cat-cursor-ltx-'));

try {
  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-i', videoPath,
    '-vf', `select='${selectExpression}'`,
    '-fps_mode', 'passthrough',
    join(temporaryPath, 'frame-%03d.png'),
    '-y',
  ]);

  mkdirSync(outputPath, { recursive: true });
  for (const filename of readdirSync(outputPath)) {
    if (/^frame-\d{3}\.webp$/.test(filename)) rmSync(join(outputPath, filename));
  }

  for (let poseIndex = 2; poseIndex < poseCount; poseIndex += 1) {
    const frame = String(poseIndex).padStart(3, '0');
    const offset = endpointOffset(
      poseIndex,
      poseCount,
      rampFrames,
      startOffset,
      endOffset,
    ).toFixed(4);
    const luminance = [
      `min(val+${offset}*max(0,min(1,(232-val)/22))`,
      '+if(lt(val,210),0,2*(val-210)/20),235)',
    ].join('');

    run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-i', join(temporaryPath, `frame-${frame}.png`),
      '-vf', `scale=405:720:flags=lanczos,format=yuv420p,lutyuv=y='${luminance}':u=val:v=val`,
      '-c:v', 'libwebp',
      '-quality', String(quality),
      '-compression_level', '6',
      '-frames:v', '1',
      join(outputPath, `frame-${frame}.webp`),
      '-y',
    ]);
  }

  console.log(JSON.stringify({
    video: basename(videoPath),
    sourceFrames: sourceCount,
    poses: poseCount,
    interiorFrames: poseCount - 2,
    selectedSourceFrames: indices.map((index) => index + 1),
    startOffset,
    endOffset,
    rampFrames,
    output: outputPath,
  }, null, 2));
} finally {
  rmSync(temporaryPath, { recursive: true, force: true });
}
