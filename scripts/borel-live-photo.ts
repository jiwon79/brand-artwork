import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { zipSync, strToU8 } from 'fflate';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { livePhotoPackage, LivePhotoDownloads, livePhotoDownloadRoute } from './borel-live-photo-package';

const run = promisify(execFile);
const limit = 24 * 1024 * 1024;
const route = '/api/borel-live-photo';
const instructions = `Borel Live Photo — 1290 × 2796 video, 2580 × 5592 still, 60 fps, 1 second

The handwriting is complete at 0.8s. The completed frame at 0.8s is the still photo.
name.HEIC and name.MOV share an Apple asset identifier and a timed still-image marker.

On a Mac, extract this ZIP and import BOTH name.HEIC and name.MOV together into Photos.
Confirm that Photos shows a single item marked LIVE before sharing it to your iPhone
using AirDrop (share the Live Photo from Photos, rather than each file separately),
or synchronizing through iCloud Photos. Keep Live Photo enabled when sharing.

On iPhone: Photos > Share > Use as Wallpaper. Enable the Live Photo motion button.
Lock-screen eligibility and the portion played depend on iOS and must be checked
on the actual phone. A valid Live Photo does not guarantee wallpaper eligibility.
For the app-free iPhone import, download the separate .pvt.zip package from the page.
In Safari Downloads, open that file, then Share > Save Image. Confirm LIVE in Photos.
This flat Mac ZIP is not the iPhone package.
`;

/** Native conversion stays on the Mac serving this page; temporary media is removed. */
export function borelLivePhoto(root: string): Plugin {
  let compiler: Promise<string> | undefined;
  let directory: string | undefined;
  let busy = false;
  const downloads = new LivePhotoDownloads();
  const executable = () => compiler ??= (async () => {
    directory = await mkdtemp(join(tmpdir(), 'borel-compiler-'));
    const binary = join(directory, 'convert');
    await run('/usr/bin/swiftc', ['-O', join(root, 'scripts/borel-live-photo.swift'), '-o', binary], { timeout: 60_000 });
    return binary;
  })().catch(async error => { compiler = undefined; if (directory) await rm(directory, { recursive: true, force: true }); throw error; });
  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== route && !url.pathname.startsWith(livePhotoDownloadRoute)) { next(); return; }
    res.setHeader('Cache-Control', 'no-store');
    const json = (code: number, message: string) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: message })); };
    if (url.pathname.startsWith(livePhotoDownloadRoute)) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { json(405, '지원하지 않는 요청입니다.'); return; }
      const file = downloads.get(url.pathname);
      if (!file) { json(410, '다운로드 링크가 만료됐습니다. 페이지에서 Live Photo를 다시 준비해 주세요.'); return; }
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
      res.setHeader('Content-Length', file.archive.byteLength);
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(file.archive));
      return;
    }
    if (process.platform !== 'darwin') { json(503, 'Live Photo 변환은 Mac 서버에서 사용할 수 있습니다.'); return; }
    if (req.method === 'GET') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ available: true })); return; }
    if (req.method !== 'POST') { json(405, '지원하지 않는 요청입니다.'); return; }
    const format = url.searchParams.get('format') ?? 'mac';
    if (format !== 'mac' && format !== 'pvt') { json(400, '지원하지 않는 파일 형식입니다.'); return; }
    // No cross-origin uploads to the native converter, even on a LAN dev server.
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) { json(403, '같은 페이지에서만 저장할 수 있습니다.'); return; } }
      catch { json(403, '요청 출처를 확인할 수 없습니다.'); return; }
    }
    const contentType = req.headers['content-type'] ?? '';
    const multipart = contentType.startsWith('multipart/form-data;');
    if (contentType !== 'video/mp4' && !multipart) { json(415, 'MP4 영상과 PNG 이미지가 필요합니다.'); return; }
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
      const input = join(work, 'input.mp4'), poster = join(work, 'cover.png');
      if (multipart) {
        const form = await new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': contentType }, body: Buffer.concat(parts) }).formData();
        const video = form.get('video'), cover = form.get('cover');
        if (!(video instanceof File) || video.type !== 'video/mp4' || !(cover instanceof File) || cover.type !== 'image/png') { json(415, 'MP4 영상과 PNG 이미지가 필요합니다.'); return; }
        await Promise.all([writeFile(input, Buffer.from(await video.arrayBuffer())), writeFile(poster, Buffer.from(await cover.arrayBuffer()))]);
      } else await writeFile(input, Buffer.concat(parts));
      await run(await executable(), [input, work, ...(multipart ? [poster] : [])], { timeout: 45_000 });
      const [still, movie] = await Promise.all([readFile(join(work, 'name.HEIC')), readFile(join(work, 'name.MOV'))]);
      if (format === 'pvt') {
        const file = livePhotoPackage(still, movie, url.searchParams.get('name') ?? undefined);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(downloads.add(file)));
        return;
      }
      const archive = zipSync({ 'name.HEIC': [still, { level: 0 }], 'name.MOV': [movie, { level: 0 }], 'READ-ME.txt': strToU8(instructions) });
      res.setHeader('Content-Type', 'application/zip'); res.setHeader('Content-Disposition', 'attachment; filename="borel-live-photo.zip"');
      res.end(Buffer.from(archive));
    } catch {
      json(500, 'Live Photo 변환에 실패했습니다. 다시 시도해 주세요. 영상 다운로드도 사용할 수 있습니다.');
    } finally { busy = false; if (work) await rm(work, { recursive: true, force: true }); }
  };
  const cleanup = () => { downloads.clear(); if (directory) void rm(directory, { recursive: true, force: true }); };
  return {
    name: 'borel-live-photo',
    configureServer(server) { server.middlewares.use(middleware); server.httpServer?.once('close', cleanup); },
    configurePreviewServer(server) { server.middlewares.use(middleware); server.httpServer?.once('close', cleanup); },
  };
}
