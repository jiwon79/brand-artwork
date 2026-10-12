import { test, expect, vi } from 'vitest';
import { waitForWallpaperStep } from './wallpaper-deadline';

test('a stalled encoding step reports a recoverable error after thirty seconds', async () => {
  vi.useFakeTimers();
  try {
    const result = waitForWallpaperStep(new Promise(() => {}));
    const failure = expect(result).rejects.toThrow('이 브라우저에서 영상 생성이 멈췄습니다.');
    await vi.advanceTimersByTimeAsync(30_000);
    await failure;
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

test('completed steps return their result and remove their timer', async () => {
  vi.useFakeTimers();
  try {
    expect(await waitForWallpaperStep(Promise.resolve('encoded'))).toBe('encoded');
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

test('encoder errors are preserved and cannot leave a later timeout', async () => {
  vi.useFakeTimers();
  try {
    const error = new Error('codec failed');
    await expect(waitForWallpaperStep(Promise.reject(error))).rejects.toBe(error);
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

test('slow but advancing frame steps each get their own deadline', async () => {
  vi.useFakeTimers();
  try {
    for (let frame = 0; frame < 3; frame++) {
      const value = waitForWallpaperStep(new Promise<number>(resolve => setTimeout(() => resolve(frame), 20_000)));
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await value).toBe(frame);
    }
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
