import { expect, test } from 'vitest';
import { chooseVideoType, videoTime } from './video-export';

test('prefers H264 MP4 over WebM for Photos-compatible exports', () => {
  expect(chooseVideoType(() => true)).toBe('video/mp4;codecs=avc1.42E033');
});
test('falls back to supported MP4 or WebM without mislabeling the container', () => {
  expect(chooseVideoType(type => type === 'video/mp4')).toBe('video/mp4');
  expect(chooseVideoType(type => type === 'video/webm;codecs=vp8')).toBe('video/webm;codecs=vp8');
  expect(() => chooseVideoType(() => false)).toThrow('지원하지');
});
test('export follows playback speed, starts empty, and holds the finished word', () => {
  expect(videoTime(-1, 6, 2)).toBe(0);
  expect(videoTime(1, 6, 2)).toBe(2);
  expect(videoTime(2, 6, 5)).toBe(6);
  expect(videoTime(4, 6, 2)).toBe(6);
});
