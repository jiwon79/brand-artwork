import { expect, test, vi } from 'vitest';
import { prefersPhotoShare, shareArtworkPhoto } from './photo-share';

const photo = new File(['png'], 'cursive.png', { type: 'image/png' });
type Host = NonNullable<Parameters<typeof shareArtworkPhoto>[1]>;
function host(overrides: Partial<Host> = {}): Host {
  return {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    platform: 'iPhone', maxTouchPoints: 5,
    userActivation: { isActive: true },
    canShare: vi.fn(() => true), share: vi.fn(async () => {}),
    ...overrides,
  };
}

test('iPhone and desktop-mode iPad share; desktop Macs and Android retain downloads', () => {
  expect(prefersPhotoShare(host())).toBe(true);
  expect(prefersPhotoShare(host({ userAgent: 'Macintosh', platform: 'MacIntel' }))).toBe(true);
  expect(prefersPhotoShare(host({ userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 0 }))).toBe(false);
  expect(prefersPhotoShare(host({ userAgent: 'Android', platform: 'Linux armv8l' }))).toBe(false);
});

test('shares only the original PNG file, with no URL or text attachment', async () => {
  const device = host();
  expect(await shareArtworkPhoto(photo, device)).toBe('shared');
  expect(device.canShare).toHaveBeenCalledWith({ files: [photo] });
  expect(device.share).toHaveBeenCalledExactlyOnceWith({ files: [photo] });
});

test('expired activation retains the image for a fresh tap, with no share attempt', async () => {
  const device = host({ userActivation: { isActive: false } });
  expect(await shareArtworkPhoto(photo, device)).toBe('retry');
  expect(device.share).not.toHaveBeenCalled();
});

test('fresh tap calls share synchronously before awaiting its result', async () => {
  const device = host();
  const result = shareArtworkPhoto(photo, device);
  expect(device.share).toHaveBeenCalledExactlyOnceWith({ files: [photo] });
  expect(await result).toBe('shared');
});

test('older Safari activation rejection allows a fresh-tap retry', async () => {
  const device = host({ userActivation: undefined, share: vi.fn(async () => { throw new DOMException('Expired', 'NotAllowedError'); }) });
  expect(await shareArtworkPhoto(photo, device)).toBe('retry');
});

test('dismissing the share sheet is cancellation, not an error or retry', async () => {
  const device = host({ share: vi.fn(async () => { throw new DOMException('Cancelled', 'AbortError'); }) });
  expect(await shareArtworkPhoto(photo, device)).toBe('cancelled');
});

test('unsupported file sharing reports the limitation instead of sharing a page link', async () => {
  const device = host({ canShare: vi.fn(() => false) });
  await expect(shareArtworkPhoto(photo, device)).rejects.toThrow('이 파일의 공유를 지원하지 않습니다');
  expect(device.share).not.toHaveBeenCalled();
});

test('unexpected share failures remain visible to the caller', async () => {
  const device = host({ share: vi.fn(async () => { throw new DOMException('Failed', 'DataError'); }) });
  await expect(shareArtworkPhoto(photo, device)).rejects.toMatchObject({ name: 'DataError' });
});

test('shares the original MP4 file alone for iPhone video saving', async () => {
  const video = new File(['mp4'], 'cursive.mp4', { type: 'video/mp4' });
  const device = host();
  expect(await shareArtworkPhoto(video, device)).toBe('shared');
  expect(device.share).toHaveBeenCalledExactlyOnceWith({ files: [video] });
});
