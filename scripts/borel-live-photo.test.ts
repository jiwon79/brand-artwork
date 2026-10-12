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

test.skipIf(!ffmpeg || !ffprobe)('HTTP PVT export stays within one second, decodes in PhotoKit, and retains the Mac ZIP', async () => {
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
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=beige:s=1080x2340:r=60:d=1', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', input]);
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
    expect([video.width, video.height, video.nb_frames, video.r_frame_rate]).toEqual([1080, 2340, '60', '60/1']);
    expect(Number(info.format.duration)).toBe(1);
    expect(info.format.tags['com.apple.quicktime.content.identifier']).toMatch(/^[A-F0-9-]{36}$/);
    expect(info.streams.filter((stream: { codec_tag_string: string }) => stream.codec_tag_string === 'mebx')).toHaveLength(2);
    expect(video.codec_name).toBe('hevc'); expect(video.profile).toBe('Main 10');
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
    // A blue original PNG and a beige movie catch accidental extraction of
    // the lossy video frame instead of preserving the supplied 2x cover.
    const highVideo = join(directory, 'high.mp4'), highCover = join(directory, 'high.png');
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=beige:s=1290x2796:r=60:d=1', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', highVideo]);
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=2580x5592', '-frames:v', '1', highCover]);
    const form = new FormData();
    form.append('video', new Blob([new Uint8Array(await readFile(highVideo))], { type: 'video/mp4' }), 'name.mp4');
    form.append('cover', new Blob([new Uint8Array(await readFile(highCover))], { type: 'image/png' }), 'cover.png');
    const high = await fetch(`${endpoint}?format=pvt&name=high`, { method: 'POST', headers: { Origin: origin }, body: form });
    expect(high.status).toBe(200);
    const highFile = await high.json(), highEntries = unzipSync(new Uint8Array(await (await fetch(origin + highFile.downloadURL)).arrayBuffer()));
    await writeFile(join(output, 'name.HEIC'), highEntries['high.pvt/high.HEIC']);
    await writeFile(join(output, 'name.MOV'), highEntries['high.pvt/high.MOV']);
    const highInfo = JSON.parse((await run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', join(output, 'name.MOV')])).stdout);
    const highStream = highInfo.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video');
    expect([highStream.width, highStream.height, highStream.nb_frames, highStream.profile]).toEqual([1290, 2796, '60', 'Main 10']);
    expect(Number(highInfo.format.duration)).toBe(1);
    const coverProbe = join(directory, 'cover.swift');
    await writeFile(coverProbe, `import Foundation
import ImageIO
import CoreGraphics
let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: CommandLine.arguments[1]) as CFURL, nil)!
let image = CGImageSourceCreateImageAtIndex(source, 0, nil)!
let context = CGContext(data: nil, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
context.draw(image, in: CGRect(x: 0, y: 0, width: 1, height: 1))
let pixel = context.data!.assumingMemoryBound(to: UInt8.self)
print("\\(image.width),\\(image.height),\\(pixel[0]),\\(pixel[1]),\\(pixel[2])")`);
    const coverValues = (await run('/usr/bin/swift', [coverProbe, join(output, 'name.HEIC')])).stdout.trim().split(',').map(Number);
    expect(coverValues.slice(0, 2)).toEqual([2580, 5592]);
    const originalValues = (await run('/usr/bin/swift', [coverProbe, highCover])).stdout.trim().split(',').map(Number);
    for (let channel = 2; channel < 5; channel++) expect(Math.abs(coverValues[channel] - originalValues[channel])).toBeLessThanOrEqual(3);
    expect(coverValues[4]).toBeGreaterThan(245);
    expect((await run('/usr/bin/swift', [probeFile, output], { timeout: 20_000 })).stdout.trim()).toBe('recognized');
    const missingCover = new FormData(); missingCover.append('video', form.get('video')!);
    expect((await fetch(endpoint, { method: 'POST', body: missingCover })).status).toBe(415);
    const motionProbe = join(directory, 'motion.swift');
    await writeFile(motionProbe, `import Foundation
import AVFoundation
import CoreMedia
let asset = AVURLAsset(url: URL(fileURLWithPath: CommandLine.arguments[1]))
var keys: [String] = [], frames = 0, marker = 0.0, identity = false, referenced = true
for track in asset.tracks(withMediaType: .metadata) {
    let format = track.formatDescriptions[0] as! CMFormatDescription
    let identifiers = CMMetadataFormatDescriptionGetIdentifiers(format) as! [String]
    keys += identifiers
    referenced = referenced && track.associatedTracks(ofType: .metadataReferent).count == 1
    let reader = try AVAssetReader(asset: asset), output = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
    reader.add(output); reader.startReading()
    while let sample = output.copyNextSampleBuffer() {
        if CMSampleBufferGetNumSamples(sample) == 0 { continue }
        if identifiers.contains("mdta/com.apple.quicktime.live-photo-info") {
            precondition(CMSampleBufferGetTotalSampleSize(sample) == 144)
            precondition(abs(CMSampleBufferGetPresentationTimeStamp(sample).seconds - Double(frames)/60) < 0.001)
            frames += 1
        } else {
            let block = CMSampleBufferGetDataBuffer(sample)!
            var bytes = [UInt8](repeating: 0, count: CMBlockBufferGetDataLength(block))
            CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: bytes.count, destination: &bytes)
            let expected: [Double] = [1,0,0,0,1,0,0,0,1]
            identity = bytes.count == 89 && (0..<9).allSatisfy { i in
                let bits = bytes[(17+i*8)..<(25+i*8)].reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
                return Double(bitPattern: bits) == expected[i]
            }
        }
    }
    if !identifiers.contains("mdta/com.apple.quicktime.live-photo-info") {
        // The metadata adaptor maps media-relative sample times through the
        // movie edit list; raw AVAssetReader samples can report a zero PTS.
        let timedReader = try AVAssetReader(asset: asset)
        let timedOutput = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
        let adaptor = AVAssetReaderOutputMetadataAdaptor(assetReaderTrackOutput: timedOutput)
        timedReader.add(timedOutput); timedReader.startReading()
        marker = adaptor.nextTimedMetadataGroup()!.timeRange.start.seconds
    }
}
let report: [String:Any] = ["keys": keys.sorted(), "frames": frames, "poster": marker, "identity": identity, "referenced": referenced]
print(String(data: try JSONSerialization.data(withJSONObject: report), encoding: .utf8)!)`);
    const motionReport = JSON.parse((await run('/usr/bin/swift', [motionProbe, join(output, 'name.MOV')])).stdout);
    expect(motionReport).toEqual({
      keys: ['mdta/com.apple.quicktime.live-photo-info', 'mdta/com.apple.quicktime.live-photo-still-image-transform', 'mdta/com.apple.quicktime.still-image-time'],
      frames: 60, poster: .8, identity: true, referenced: true,
    });
    const mac = await upload();
    expect(mac.headers.get('content-type')).toBe('application/zip');
    expect(Object.keys(unzipSync(new Uint8Array(await mac.arrayBuffer()))).sort()).toEqual(['READ-ME.txt', 'name.HEIC', 'name.MOV']);
    // Stale two-second clients cannot silently bypass the new output limit.
    const longVideo = join(directory, 'long.mp4');
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=beige:s=1080x2340:r=60:d=2', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', longVideo]);
    expect((await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'video/mp4', Origin: origin }, body: new Uint8Array(await readFile(longVideo)) })).status).toBe(500);
    // Malformed uploads must fail, rather than returning an apparently valid pair.
    expect((await fetch(`${endpoint}?format=pvt`, { method: 'POST', headers: { 'Content-Type': 'video/mp4', Origin: origin }, body: 'not a movie' })).status).toBe(500);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 90_000);
