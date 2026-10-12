import { test, expect } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { ViteDevServer } from 'vite';
import { unzipSync } from 'fflate';
import { borelLivePhoto } from './borel-live-photo';

const run = promisify(execFile);
let ffmpeg = '', ffprobe = '';
if (process.platform === 'darwin') {
  try {
    ffmpeg = execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim();
    ffprobe = execFileSync('which', ['ffprobe'], { encoding: 'utf8' }).trim();
  } catch { /* Native integration requires macOS, Swift and optional FFmpeg fixtures. */ }
}

test.skipIf(!ffmpeg || !ffprobe)('HTTP PVT export preserves 120 frames, decodes in PhotoKit, and retains the Mac ZIP', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'borel-live-test-'));
  let middleware: (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>;
  const server = createServer((req, res) => { void middleware(req, res, () => { res.statusCode = 404; res.end(); }); });
  const plugin = borelLivePhoto(new URL('..', import.meta.url).pathname);
  const configure = plugin.configureServer as (server: ViteDevServer) => void;
  configure({ middlewares: { use(handler: typeof middleware) { middleware = handler; } }, httpServer: server } as unknown as ViteDevServer);
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No HTTP test port');
    const origin = `http://127.0.0.1:${address.port}`, endpoint = `${origin}/api/borel-live-photo`;
    const input = join(directory, 'input.mp4'), output = join(directory, 'result');
    await mkdir(output);
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=beige:s=1080x2340:r=60:d=2', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', input]);
    expect(await (await fetch(endpoint)).json()).toEqual({ available: true });
    const body = new Uint8Array(await readFile(input));
    const upload = (url = endpoint, headers = { 'Content-Type': 'video/mp4', Origin: origin }) => fetch(url, { method: 'POST', headers, body });
    expect((await upload(endpoint, { 'Content-Type': 'video/mp4', Origin: 'https://other.example' })).status).toBe(403);
    expect((await upload(`${endpoint}?format=unknown`)).status).toBe(400);
    expect((await upload(endpoint, { 'Content-Type': 'image/png', Origin: origin })).status).toBe(415);
    const response = await upload(`${endpoint}?format=pvt&name=borel-test`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const file = await response.json();
    expect(file.filename).toBe('borel-test.pvt.zip');
    const downloaded = await fetch(origin + file.downloadURL);
    expect(downloaded.headers.get('content-type')).toBe('application/zip');
    expect(downloaded.headers.get('content-disposition')).toBe('attachment; filename="borel-test.pvt.zip"');
    const bytes = new Uint8Array(await downloaded.arrayBuffer());
    expect(Number(downloaded.headers.get('content-length'))).toBe(bytes.length);
    const entries = unzipSync(bytes);
    expect(Object.keys(entries)).toHaveLength(3);
    await writeFile(join(output, 'name.HEIC'), entries['borel-test.pvt/borel-test.HEIC']);
    await writeFile(join(output, 'name.MOV'), entries['borel-test.pvt/borel-test.MOV']);
    const head = await fetch(origin + file.downloadURL, { method: 'HEAD' });
    expect(head.status).toBe(200); expect((await head.arrayBuffer()).byteLength).toBe(0);
    expect((await fetch(origin + file.downloadURL.replace('borel-test', 'wrong'))).status).toBe(410);
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
    const probeFile = join(directory, 'probe.swift'); await writeFile(probeFile, probe);
    expect((await run('/usr/bin/swift', [probeFile, output], { timeout: 20_000 })).stdout.trim()).toBe('recognized');
    const mac = await upload();
    expect(mac.headers.get('content-type')).toBe('application/zip');
    expect(Object.keys(unzipSync(new Uint8Array(await mac.arrayBuffer()))).sort()).toEqual(['READ-ME.txt', 'name.HEIC', 'name.MOV']);
    // Malformed uploads must fail, rather than returning an apparently valid pair.
    expect((await fetch(`${endpoint}?format=pvt`, { method: 'POST', headers: { 'Content-Type': 'video/mp4', Origin: origin }, body: 'not a movie' })).status).toBe(500);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 90_000);
