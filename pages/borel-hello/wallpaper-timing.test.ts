import { test, expect } from 'vitest';
import { composeText } from './lettering';
import { preparePen } from './pen-geometry';
import { createPenPlayback, strokeState } from './pen-playback';
import { shaper, catalog } from './test-font';
import { WALLPAPER, wallpaperProgress, wallpaperFrameProgress, wallpaperPlacement, wallpaperFilename } from './wallpaper-timing';

test('one-second export finishes all strokes and deferred marks by frame 48', () => {
  expect(WALLPAPER.duration).toBe(1);
  expect(WALLPAPER.fps * WALLPAPER.duration).toBe(60);
  for (const text of ['jiwon', 'Jiwon', 'hello', 'tttsss', 'my name is jiwon']) {
    const playback = createPenPlayback(composeText(text, shaper, catalog).strokes.map(preparePen));
    let before = -1;
    for (let frame = 0; frame < WALLPAPER.fps * WALLPAPER.duration; frame++) {
      const p = wallpaperProgress(frame / WALLPAPER.fps);
      expect(p).toBeGreaterThanOrEqual(before); before = p;
      if (frame < WALLPAPER.lead * WALLPAPER.fps) expect(p).toBe(0);
      if (frame >= 48) for (const stroke of playback.strokes) {
        const state = strokeState(stroke, p * playback.duration);
        expect(state.written).toBe(stroke.pen.length); expect(state.pressure).toBe(1);
      }
    }
    const marks = playback.strokes.filter(stroke => stroke.dot);
    for (let i = 1; i < marks.length; i++) expect(marks[i].start).toBeGreaterThan(marks[i - 1].end);
  }
});

test('the opening video frame matches the complete still, then the pen replays in order', () => {
  for (const text of ['jiwon', 'Jiwon', 'hello', 'tttsss', 'my name is jiwon']) {
    const playback = createPenPlayback(composeText(text, shaper, catalog).strokes.map(preparePen));
    for (const frame of [0, 48, 59]) for (const stroke of playback.strokes) {
      const state = strokeState(stroke, wallpaperFrameProgress(frame) * playback.duration);
      expect(state.written).toBe(stroke.pen.length); expect(state.pressure).toBe(1);
    }
    let before = 0;
    for (let frame = 1; frame < 60; frame++) {
      const progress = wallpaperFrameProgress(frame);
      expect(progress).toBeGreaterThanOrEqual(before); before = progress;
      if (frame < 6) expect(progress).toBe(0);
    }
  }
});

test('poster is after handwriting and within the encoded clip', () => {
  expect(wallpaperProgress(WALLPAPER.poster)).toBe(1);
  expect(WALLPAPER.poster).toBeLessThan(WALLPAPER.duration);
  expect(WALLPAPER.poster * WALLPAPER.fps).toBe(48);
  expect(wallpaperProgress(47 / 60)).toBeLessThan(1);
  expect(wallpaperProgress(59 / 60)).toBe(1);
  expect(wallpaperProgress(-1)).toBe(0); expect(wallpaperProgress(10)).toBe(1);
});

test('wide names and tall multi-line lettering fit below the clock without distortion', () => {
  for (const bounds of [[-50, -1000, 5000, 1000], [0, 0, 200, 4000], [0, 0, 0, 0]] as const) {
    const result = wallpaperPlacement([...bounds]);
    expect(result.x).toBeGreaterThanOrEqual(0);
    expect(result.x + result.width).toBeLessThanOrEqual(WALLPAPER.width);
    expect(result.y).toBeGreaterThan(WALLPAPER.height * .35);
    expect(result.y + result.height).toBeLessThan(WALLPAPER.height * .75);
    if (bounds[2] > bounds[0] && bounds[3] > bounds[1]) expect(result.width / result.height).toBeCloseTo((bounds[2] - bounds[0]) / (bounds[3] - bounds[1]), 8);
  }
});

test('download names cannot contain paths or control characters', () => {
  expect(wallpaperFilename('../Jiwon / hello\n')).toBe('borel-Jiwon-hello');
  expect(wallpaperFilename('  ')).toBe('borel-name');
});
