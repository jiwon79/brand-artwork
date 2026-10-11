import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { zipSync, strToU8 } from 'fflate';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const run = promisify(execFile);
const limit = 24 * 1024 * 1024;
const route = '/api/borel-live-photo';
const instructions = `Borel Live Photo — 1080 × 2340, 60 fps, 2 seconds

The handwriting is complete at 1.5s. The completed frame at 1.5s is the still photo.
name.HEIC and name.MOV share an Apple asset identifier and a timed still-image marker.

On a Mac, extract this ZIP and import BOTH name.HEIC and name.MOV together into Photos.
Confirm that Photos shows a single item marked LIVE before sharing it to your iPhone
using AirDrop (share the Live Photo from Photos, rather than each file separately),
or synchronizing through iCloud Photos. Keep Live Photo enabled when sharing.

On iPhone: Photos > Share > Use as Wallpaper. Enable the Live Photo motion button.
Lock-screen eligibility and the portion played depend on iOS and must be checked
on the actual phone. A valid Live Photo does not guarantee wallpaper eligibility.
If motion is unavailable, use the separately downloadable MP4 with intoLive's
Live Wallpaper mode. Importing a ZIP directly into iPhone Photos is not supported.
`;

/** Native conversion stays on the Mac serving this page; temporary media is removed. */
export function borelLivePhoto(root: string): Plugin {
  let compiler: Promise<string> | undefined;
  let directory: string | undefined;
  let busy = false;
  const executable = () => compiler ??= (async () => {
    directory = await mkdtemp(join(tmpdir(), 'borel-compiler-'));
    const binary = join(directory, 'convert');
    await run('/usr/bin/swiftc', ['-O', join(root, 'scripts/borel-live-photo.swift'), '-o', binary], { timeout: 60_000 });
    return binary;
  })().catch(async error => { compiler = undefined; if (directory) await rm(directory, { recursive: true, force: true }); throw error; });
  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url?.split('?')[0] !== route) { next(); return; }
    res.setHeader('Cache-Control', 'no-store');
    const json = (code: number, message: string) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: message })); };
    if (process.platform !== 'darwin') { json(503, 'Live Photo 변환은 Mac 서버에서 사용할 수 있습니다.'); return; }
    if (req.method === 'GET') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ available: true })); return; }
    if (req.method !== 'POST') { json(405, '지원하지 않는 요청입니다.'); return; }
    // No cross-origin uploads to the native converter, even on a LAN dev server.
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) { json(403, '같은 페이지에서만 저장할 수 있습니다.'); return; } }
      catch { json(403, '요청 출처를 확인할 수 없습니다.'); return; }
    }
    if (req.headers['content-type'] !== 'video/mp4') { json(415, 'MP4 영상이 필요합니다.'); return; }
    if (Number(req.headers['content-length']) > limit) { json(413, '영상 파일이 너무 큽니다.'); return; }
    if (busy) { json(429, '다른 저장 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.'); return; }
    busy = true;
    let work: string | undefined;
    try {
      const parts: Buffer[] = []; let size = 0;
      for await (const data of req) {
        const chunk = Buffer.from(data); size += chunk.length;
        if (size > limit) { json(413, '영상 파일이 너무 큽니다.'); return; }
        parts.push(chunk);
      }
      work = await mkdtemp(join(tmpdir(), 'borel-live-'));
      const input = join(work, 'input.mp4'); await writeFile(input, Buffer.concat(parts));
      await run(await executable(), [input, work], { timeout: 45_000 });
      const [still, movie] = await Promise.all([readFile(join(work, 'name.HEIC')), readFile(join(work, 'name.MOV'))]);
      const archive = zipSync({ 'name.HEIC': [still, { level: 0 }], 'name.MOV': [movie, { level: 0 }], 'READ-ME.txt': strToU8(instructions) });
      res.setHeader('Content-Type', 'application/zip'); res.setHeader('Content-Disposition', 'attachment; filename="borel-live-photo.zip"');
      res.end(Buffer.from(archive));
    } catch {
      json(500, 'Live Photo 변환에 실패했습니다. MP4로 저장한 뒤 intoLive에서 변환할 수 있습니다.');
    } finally { busy = false; if (work) await rm(work, { recursive: true, force: true }); }
  };
  const cleanup = () => { if (directory) void rm(directory, { recursive: true, force: true }); };
  return {
    name: 'borel-live-photo',
    configureServer(server) { server.middlewares.use(middleware); server.httpServer?.once('close', cleanup); },
    configurePreviewServer(server) { server.middlewares.use(middleware); server.httpServer?.once('close', cleanup); },
  };
}
