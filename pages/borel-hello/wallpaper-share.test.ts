import { test, expect, vi } from 'vitest';
import { canShareWallpaper, shareWallpaper } from './wallpaper-share';

const image = new File(['png bytes'], 'borel-jiwon.png', { type: 'image/png' });
const video = new File(['mp4 bytes'], 'borel-jiwon.mp4', { type: 'video/mp4' });

test('check the actual file type independently, without opening a share sheet', () => {
  const share = vi.fn(), target = { share, canShare: ({ files }: ShareData) => files?.[0].type === 'image/png' };
  expect(canShareWallpaper(target, image)).toBe(true);
  expect(canShareWallpaper(target, video)).toBe(false);
  expect(share).not.toHaveBeenCalled();
});

test('missing, denied or throwing capability checks retain the download fallback', async () => {
  expect(canShareWallpaper({}, image)).toBe(false);
  expect(canShareWallpaper({ canShare: () => true }, image)).toBe(false);
  const share = vi.fn();
  const target = { share, canShare: () => { throw new Error('denied'); } };
  expect(await shareWallpaper(target, image)).toBe('unsupported');
  expect(share).not.toHaveBeenCalled();
});

test('share begins within the click task and passes exactly one ready media file', async () => {
  const share = vi.fn(async () => {}), target = { canShare: () => true, share };
  const pending = shareWallpaper(target, video);
  expect(share).toHaveBeenCalledExactlyOnceWith({ files: [video] });
  expect(await pending).toBe('shared');
  expect(video.name).toBe('borel-jiwon.mp4');
  expect(video.type).toBe('video/mp4');
});

test('cancelling the sheet is not reported as a completed share', async () => {
  const target = { canShare: () => true, share: async () => { throw new DOMException('cancel', 'AbortError'); } };
  expect(await shareWallpaper(target, image)).toBe('cancelled');
});

test('real share failures propagate to the download fallback message', async () => {
  const target = { canShare: () => true, share: async () => { throw new DOMException('activation required', 'NotAllowedError'); } };
  await expect(shareWallpaper(target, image)).rejects.toThrow('activation required');
});
