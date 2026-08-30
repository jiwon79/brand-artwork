import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_BUCKET = 'brand-artwork-cursor-animals';
const DEFAULT_ARC_FRAME_COUNT = 49;
const DEFAULT_RADIAL_FRAME_COUNT = 24;
const ID_PATTERN = /^[a-z0-9]{10}$/;
const FRAME_PATTERN = /^frame-(\d{3})\.webp$/;
const WRANGLER = resolve(
  'node_modules', '.bin', process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler',
);

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

function requiredNumber(value, fallback, name) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 3) {
    throw new Error(`${name} must be an integer of at least 3`);
  }
  return number;
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

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function assertFile(path) {
  if (!statSync(path, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Missing required asset: ${path}`);
  }
}

function assertFrames(sourcePath, directory, totalFrameCount) {
  const frameDirectory = join(sourcePath, 'frames', directory);
  const indices = readdirSync(frameDirectory)
    .map((filename) => FRAME_PATTERN.exec(filename)?.[1])
    .filter(Boolean)
    .map(Number)
    .sort((a, b) => a - b);
  const expected = Array.from({ length: totalFrameCount - 2 }, (_, index) => index + 2);

  if (indices.length !== expected.length || indices.some((value, index) => value !== expected[index])) {
    throw new Error(
      `${frameDirectory} must contain frame-002.webp through frame-${String(totalFrameCount - 1).padStart(3, '0')}.webp`,
    );
  }
}

function contentType(path) {
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
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

async function uploadFile(bucket, objectKey, filePath, cacheControl) {
  await execFileAsync(WRANGLER, [
    'r2', 'object', 'put', `${bucket}/${objectKey}`,
    '--file', filePath,
    '--content-type', contentType(filePath),
    '--cache-control', cacheControl,
    '--remote',
  ], { maxBuffer: 1024 * 1024 * 8 });
}

function usage() {
  return [
    'Usage:',
    '  pnpm register:cursor-animal --source <asset-dir> --name <display-name> [options]',
    '',
    'Options:',
    '  --id <id>                 Use main or a fixed 10-character lowercase ID',
    `  --bucket <name>           R2 bucket (default: ${DEFAULT_BUCKET})`,
    `  --arc-frames <count>      Poses in each semicircle (default: ${DEFAULT_ARC_FRAME_COUNT})`,
    `  --radial-frames <count>   Poses in each center path (default: ${DEFAULT_RADIAL_FRAME_COUNT})`,
    '  --alt <text>              Image alternative text',
    '  --aria-label <text>       Artwork accessibility label',
    '  --dry-run <true|false>     Validate and print the result without uploading',
  ].join('\n');
}

const options = readOptions(process.argv.slice(2));
if (!options.source || !options.name) throw new Error(usage());

const sourcePath = resolve(options.source);
const bucket = options.bucket ?? DEFAULT_BUCKET;
const id = options.id ?? randomId();
const arcFrameCount = requiredNumber(
  options['arc-frames'], DEFAULT_ARC_FRAME_COUNT, 'arc-frames',
);
const radialFrameCount = requiredNumber(
  options['radial-frames'], DEFAULT_RADIAL_FRAME_COUNT, 'radial-frames',
);
const dryRun = options['dry-run'] === 'true';

if (id !== 'main' && !ID_PATTERN.test(id)) {
  throw new Error('id must be main or a 10-character lowercase alphanumeric value');
}
if (arcFrameCount % 2 === 0) throw new Error('arc-frames must be odd');

for (const path of [
  'poster.webp',
  'center.webp',
  'endpoints/left.png',
  'endpoints/right.png',
]) {
  assertFile(join(sourcePath, path));
}
assertFrames(sourcePath, 'upper', arcFrameCount);
assertFrames(sourcePath, 'lower', arcFrameCount);
for (const direction of ['center-left', 'center-right', 'center-top', 'center-bottom']) {
  assertFrames(sourcePath, direction, radialFrameCount);
}

const manifest = {
  schemaVersion: 1,
  id,
  version: `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`,
  name: options.name,
  alt: options.alt ?? `${options.name}이 커서를 바라보는 모습`,
  ariaLabel: options['aria-label'] ?? `커서를 따라 시선을 움직이는 ${options.name}`,
  frameCounts: {
    arc: arcFrameCount,
    radial: radialFrameCount,
  },
  assets: {
    poster: 'poster.webp',
    center: 'center.webp',
    left: 'endpoints/left.png',
    right: 'endpoints/right.png',
    upper: 'frames/upper/frame-{frame}.webp',
    lower: 'frames/lower/frame-{frame}.webp',
    centerLeft: 'frames/center-left/frame-{frame}.webp',
    centerRight: 'frames/center-right/frame-{frame}.webp',
    centerTop: 'frames/center-top/frame-{frame}.webp',
    centerBottom: 'frames/center-bottom/frame-{frame}.webp',
  },
};

const files = walk(sourcePath);
const temporaryPath = mkdtempSync(join(tmpdir(), 'cursor-animal-'));
const manifestPath = join(temporaryPath, 'manifest.json');
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

try {
  if (dryRun) {
    console.log(JSON.stringify({
      id,
      name: options.name,
      bucket,
      assets: files.length,
      route: id === 'main' ? '/pages/cursor-cat/' : `/pages/cursor-cat/${id}/`,
      manifest,
    }, null, 2));
  } else {
    console.log(`Uploading ${files.length} assets to ${bucket}/cursor-cat/${id}/`);
    await runPool(files, 8, async (filePath, index) => {
      const relativePath = relative(sourcePath, filePath).split(sep).join('/');
      await uploadFile(
        bucket,
        `cursor-cat/${id}/${relativePath}`,
        filePath,
        'public, max-age=31536000, immutable',
      );
      process.stdout.write(`\r${index + 1}/${files.length} ${basename(filePath)}          `);
    });

    await uploadFile(
      bucket,
      `cursor-cat/${id}/manifest.json`,
      manifestPath,
      'public, max-age=60',
    );
    process.stdout.write('\n');
    console.log(JSON.stringify({
      id,
      name: options.name,
      bucket,
      assets: files.length,
      route: id === 'main' ? '/pages/cursor-cat/' : `/pages/cursor-cat/${id}/`,
    }, null, 2));
  }
} finally {
  rmSync(temporaryPath, { recursive: true, force: true });
}
