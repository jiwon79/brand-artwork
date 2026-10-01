import { expect, test } from 'vitest';
import { Timeline } from './timeline';

test('scrubbing backwards and forwards crosses the seam without an invalid frame', () => {
  const timeline = new Timeline(89, 30);
  timeline.seek(-1 / 30);
  expect(timeline.frame).toBe(88);
  timeline.seek(timeline.duration);
  expect(timeline.frame).toBe(0);
  timeline.seek(timeline.duration * 12 + 16 / 30);
  expect(timeline.frame).toBe(16);
});

test('pausing, scrubbing, then resuming continues from the chosen pose', () => {
  const timeline = new Timeline(89, 30);
  timeline.advance(0.5);
  timeline.playing = false;
  timeline.advance(10);
  expect(timeline.frame).toBe(15);
  timeline.seek(1.5);
  timeline.playing = true;
  timeline.advance(1 / 30);
  expect(timeline.frame).toBe(46);
});

test('playback speed preserves the reference timing independently of refresh rate', () => {
  const timeline = new Timeline(89, 30);
  for (let i = 0; i < 120; i++) timeline.advance(1 / 120);
  expect(timeline.frame).toBe(30);
  timeline.speed = 0.5;
  timeline.advance(1);
  expect(timeline.frame).toBe(45);
});
