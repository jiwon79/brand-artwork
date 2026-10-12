import { test, expect, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { livePhotoPackage, LivePhotoDownloads } from './borel-live-photo-package';

test('PVT archive wraps the paired media with the Apple complement plist', () => {
  const still = new Uint8Array([0, 4, 9, 255]), movie = new Uint8Array([8, 0, 17, 240]);
  const file = livePhotoPackage(still, movie, 'borel-jiwon');
  expect(file.filename).toBe('borel-jiwon.pvt.zip');
  const entries = unzipSync(file.archive);
  expect(Object.keys(entries).sort()).toEqual([
    'borel-jiwon.pvt/borel-jiwon.HEIC', 'borel-jiwon.pvt/borel-jiwon.MOV', 'borel-jiwon.pvt/metadata.plist',
  ]);
  expect(entries['borel-jiwon.pvt/borel-jiwon.HEIC']).toEqual(still);
  expect(entries['borel-jiwon.pvt/borel-jiwon.MOV']).toEqual(movie);
  const plist = strFromU8(entries['borel-jiwon.pvt/metadata.plist']);
  expect(plist).toContain('<plist version="1.0">');
  expect(plist).toContain('<key>PFVideoComplementMetadataVersionKey</key><string>1</string>');
});

test('package names cannot add paths or attachment header characters', () => {
  for (const name of ['../../secret\r\n"file', '', '한글', 'x'.repeat(300)]) {
    const file = livePhotoPackage(new Uint8Array(1), new Uint8Array(1), name);
    expect(file.filename).toMatch(/^[a-zA-Z0-9_-]{1,64}\.pvt\.zip$/);
    for (const entry of Object.keys(unzipSync(file.archive))) expect(entry.split('/')).toHaveLength(2);
  }
});

test('HTTP download links are unique, repeatable, and expire after ten minutes', () => {
  vi.useFakeTimers();
  const downloads = new LivePhotoDownloads();
  try {
    const file = livePhotoPackage(new Uint8Array(1), new Uint8Array(1));
    const first = downloads.add(file), second = downloads.add(file);
    expect(first.downloadURL).not.toBe(second.downloadURL);
    expect(first.expiresAt - Date.now()).toBe(600_000);
    expect(downloads.get(first.downloadURL)?.archive).toEqual(file.archive);
    expect(downloads.get(first.downloadURL)?.archive).toEqual(file.archive);
    expect(downloads.get(first.downloadURL.replace('borel-name', 'other'))).toBeUndefined();
    vi.advanceTimersByTime(600_000);
    expect(downloads.get(first.downloadURL)).toBeUndefined();
    expect(downloads.get(second.downloadURL)).toBeUndefined();
  } finally { downloads.clear(); vi.useRealTimers(); }
});

test('retained downloads are bounded and server cleanup releases them', () => {
  const downloads = new LivePhotoDownloads();
  try {
    const file = livePhotoPackage(new Uint8Array(1), new Uint8Array(1));
    const links = Array.from({ length: 5 }, () => downloads.add(file));
    expect(downloads.get(links[0].downloadURL)).toBeUndefined();
    for (const link of links.slice(1)) expect(downloads.get(link.downloadURL)).toBeDefined();
    downloads.clear();
    for (const link of links) expect(downloads.get(link.downloadURL)).toBeUndefined();
  } finally { downloads.clear(); }
});
