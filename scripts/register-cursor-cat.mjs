import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_BUCKET = 'brand-artwork-cursor-animals';
const DEFAULT_FRAME_COUNT = 120;
const OBJECT_PREFIX = 'cursor-cat';
const ID_PATTERN = /^[a-z0-9]{10}$/;
const FRAME_PATTERN = /^frame-(\d{3})\.webp$/;
const WRANGLER = resolve(
  'node_modules', '.bin', process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler',
);

function readOptions(argv) {
  const options = {};
  const args = argv.filter((argument) => argument !== '--');

  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid option near ${key ?? 'end of command'}`);
    }
    options[key.slice(2)] = value;
  }

  return options;
}

function randomId() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';

  while (id.length < 10) {
    for (const byte of randomBytes(16)) {
      if (byte >= 252) continue;
      id += alphabet[byte % alphabet.length];
      if (id.length === 10) break;
    }
  }

  return id;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function assertFile(path) {
  if (!statSync(path, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Missing required asset: ${path}`);
  }
}

function frameName(index) {
  return `frame-${String(index).padStart(3, '0')}.webp`;
}

function validateFrames(sourcePath, frameCount) {
  const expected = Array.from({ length: frameCount }, (_, index) => frameName(index + 1));
  const actual = readdirSync(sourcePath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && FRAME_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw new Error(
      `${sourcePath} must contain exactly ${frameName(1)} through ${frameName(frameCount)}`,
    );
  }

  for (const filename of expected) assertFile(join(sourcePath, filename));
  return expected;
}

function validateAnchors(anchors, frameCount, valueKeys, name) {
  if (!Array.isArray(anchors) || anchors.length < 2) {
    throw new Error(`${name} must contain at least two anchors`);
  }

  anchors.forEach((anchor, index) => {
    if (!Number.isInteger(anchor?.frame)
      || anchor.frame < 0
      || anchor.frame > frameCount
      || (index > 0 && anchor.frame <= anchors[index - 1].frame)
      || valueKeys.some((key) => !Number.isFinite(anchor[key]))) {
      throw new Error(`Invalid ${name} anchor at index ${index}`);
    }
  });

  if (anchors[0].frame !== 0 || anchors.at(-1).frame !== frameCount) {
    throw new Error(`${name} must start at frame 0 and end at frame ${frameCount}`);
  }
}

function validateCalibration(calibration, frameCount) {
  if (calibration?.frameCount !== frameCount) {
    throw new Error(`Calibration frameCount must equal ${frameCount}`);
  }
  validateAnchors(calibration.gazeOrigins, frameCount, ['x', 'y'], 'gazeOrigins');
  validateAnchors(calibration.displayScales, frameCount, ['scale'], 'displayScales');

  for (const anchor of calibration.gazeOrigins) {
    if (anchor.x < 0 || anchor.x > 1 || anchor.y < 0 || anchor.y > 1) {
      throw new Error('gazeOrigins coordinates must stay within 0..1');
    }
  }
  for (const anchor of calibration.displayScales) {
    if (anchor.scale <= 0 || anchor.scale > 2) {
      throw new Error('displayScales values must stay within 0..2');
    }
  }
}

async function runPool(items, concurrency, task) {
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await task(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

async function uploadFile(bucket, objectKey, filePath, contentType, cacheControl) {
  await execFileAsync(WRANGLER, [
    'r2', 'object', 'put', `${bucket}/${objectKey}`,
    '--file', filePath,
    '--content-type', contentType,
    '--cache-control', cacheControl,
    '--remote',
  ], { maxBuffer: 1024 * 1024 * 8 });
}

function usage() {
  return [
    'Usage:',
    '  pnpm register:cursor-cat --source <flat-frame-dir> --name <display-name> --calibration <json> [options]',
    '',
    'Options:',
    '  --id <id>                 Use main or a fixed 10-character lowercase ID',
    `  --bucket <name>           R2 bucket (default: ${DEFAULT_BUCKET})`,
    `  --frame-count <count>     Full-circle pose count (default: ${DEFAULT_FRAME_COUNT})`,
    '  --alt <text>              Image alternative text',
    '  --aria-label <text>       Artwork accessibility label',
    '  --dry-run <true|false>     Validate and print without uploading',
  ].join('\n');
}

const options = readOptions(process.argv.slice(2));
if (!options.source || !options.name || !options.calibration) throw new Error(usage());

const sourcePath = resolve(options.source);
const calibrationPath = resolve(options.calibration);
const bucket = options.bucket ?? DEFAULT_BUCKET;
const id = options.id ?? randomId();
const frameCount = Number(options['frame-count'] ?? DEFAULT_FRAME_COUNT);
const dryRun = options['dry-run'] === 'true';

if (id !== 'main' && !ID_PATTERN.test(id)) {
  throw new Error('id must be main or a 10-character lowercase alphanumeric value');
}
if (!Number.isInteger(frameCount) || frameCount < 4 || frameCount % 4 !== 0) {
  throw new Error('frame-count must be an integer divisible by four');
}

const calibration = readJson(calibrationPath);
validateCalibration(calibration, frameCount);
const frameFiles = validateFrames(sourcePath, frameCount);
const version = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
const manifest = {
  schemaVersion: 1,
  id,
  version,
  name: options.name,
  alt: options.alt ?? `${options.name}이 커서를 바라보는 모습`,
  ariaLabel: options['aria-label'] ?? `커서를 따라 시선을 움직이는 ${options.name}`,
  frameCount,
  framePattern: 'frame-{frame}.webp',
  gazeOrigins: calibration.gazeOrigins,
  displayScales: calibration.displayScales,
};

const temporaryPath = mkdtempSync(join(tmpdir(), 'cursor-cat-'));
const manifestPath = join(temporaryPath, 'manifest.json');
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
const route = id === 'main'
  ? '/pages/cursor-cat/'
  : `/pages/cursor-cat/${id}/`;

try {
  if (dryRun) {
    console.log(JSON.stringify({
      id,
      name: options.name,
      bucket,
      prefix: `${OBJECT_PREFIX}/${id}/`,
      imageAssets: frameFiles.length,
      route,
      manifest,
    }, null, 2));
  } else {
    console.log(`Uploading ${frameFiles.length} flat frames to ${bucket}/${OBJECT_PREFIX}/${id}/`);
    await runPool(frameFiles, 8, async (filename, index) => {
      await uploadFile(
        bucket,
        `${OBJECT_PREFIX}/${id}/${filename}`,
        join(sourcePath, filename),
        'image/webp',
        'public, max-age=31536000, immutable',
      );
      process.stdout.write(`\r${index + 1}/${frameFiles.length} ${basename(filename)}          `);
    });

    await uploadFile(
      bucket,
      `${OBJECT_PREFIX}/${id}/manifest.json`,
      manifestPath,
      'application/json; charset=utf-8',
      id === 'main'
        ? 'public, max-age=60'
        : 'public, max-age=31536000, immutable',
    );
    process.stdout.write('\n');
    console.log(JSON.stringify({
      id,
      name: options.name,
      bucket,
      imageAssets: frameFiles.length,
      route,
    }, null, 2));
  }
} finally {
  rmSync(temporaryPath, { recursive: true, force: true });
}
