import type { Bounds } from './lettering';

export const WALLPAPER = { width: 1290, height: 2796, fps: 60, duration: 1, lead: .1, complete: .8, poster: .8, supersample: 2, bitrate: 40_000_000 } as const;

/** Fixed output clock: pen lifts and delayed marks keep their relative order. */
export function wallpaperProgress(seconds: number) {
  return Math.max(0, Math.min(1, (seconds - WALLPAPER.lead) / (WALLPAPER.complete - WALLPAPER.lead)));
}

/** Place lettering below the lock-screen clock, with room for notifications. */
export function wallpaperPlacement(bounds: Bounds) {
  const width = Math.max(1, bounds[2] - bounds[0]), height = Math.max(1, bounds[3] - bounds[1]);
  const scale = Math.min(WALLPAPER.width * .82 / width, WALLPAPER.height * .3 / height);
  return { x: (WALLPAPER.width - width * scale) / 2, y: WALLPAPER.height * .55 - height * scale / 2, width: width * scale, height: height * scale };
}

export function wallpaperFilename(text: string) {
  return `borel-${text.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'name'}`;
}
