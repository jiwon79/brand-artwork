import { test, expect } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const run = promisify(execFile);
let ffmpeg = '', ffprobe = '';
if (process.platform === 'darwin') {
  try {
    ffmpeg = execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim();
    ffprobe = execFileSync('which', ['ffprobe'], { encoding: 'utf8' }).trim();
  } catch { /* Native integration requires macOS, Swift and optional FFmpeg fixtures. */ }
}

test.skipIf(!ffmpeg || !ffprobe)('native export preserves 120 frames and PhotoKit recognizes the pair', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'borel-live-test-'));
  try {
    const binary = join(directory, 'convert'), input = join(directory, 'input.mp4'), output = join(directory, 'result');
    await mkdir(output);
    await run('/usr/bin/swiftc', [new URL('./borel-live-photo.swift', import.meta.url).pathname, '-o', binary], { timeout: 60_000 });
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=beige:s=1080x2340:r=60:d=2', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', input]);
    const converted = await run(binary, [input, output]);
    expect(converted.stdout).toContain('matching identifiers and poster marker at 1.5s');
    const { stdout } = await run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', join(output, 'name.MOV')]);
    const info = JSON.parse(stdout), video = info.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video');
    expect([video.width, video.height, video.nb_frames, video.r_frame_rate]).toEqual([1080, 2340, '120', '60/1']);
    expect(Number(info.format.duration)).toBe(2);
    expect(info.format.tags['com.apple.quicktime.content.identifier']).toMatch(/^[A-F0-9-]{36}$/);
    expect(info.streams.filter((stream: { codec_tag_string: string }) => stream.codec_tag_string === 'mebx')).toHaveLength(1);
    // No library import or permissions: ask PhotoKit to decode these two resources.
    const probe = `import Foundation
import Photos
import AppKit
let folder = URL(fileURLWithPath: CommandLine.arguments[1])
PHLivePhoto.request(withResourceFileURLs: [folder.appendingPathComponent("name.HEIC"), folder.appendingPathComponent("name.MOV")], placeholderImage: nil, targetSize: NSSize(width: 270, height: 585), contentMode: .aspectFit) { photo, info in
  if (info[PHLivePhotoInfoIsDegradedKey] as? Bool) == true { return }
  print(photo != nil ? "recognized" : "failed")
  exit(photo == nil ? 1 : 0)
}
RunLoop.main.run()`;
    const { writeFile } = await import('node:fs/promises');
    const probeFile = join(directory, 'probe.swift'); await writeFile(probeFile, probe);
    expect((await run('/usr/bin/swift', [probeFile, output], { timeout: 20_000 })).stdout.trim()).toBe('recognized');
    // Malformed uploads must fail, rather than returning an apparently valid pair.
    const invalid = join(directory, 'invalid.mp4'); await writeFile(invalid, 'not a movie');
    const invalidOutput = join(directory, 'invalid'); await mkdir(invalidOutput);
    await expect(run(binary, [invalid, invalidOutput])).rejects.toThrow();
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 90_000);
