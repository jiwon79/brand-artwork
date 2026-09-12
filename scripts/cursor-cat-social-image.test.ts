import { expect, test, vi } from 'vitest';
import { drawSocialImage } from './cursor-cat-social-image.mjs';

test('uses the documented Cursor Cat title typography', () => {
  const context = {
    canvas: { width: 0, height: 0 },
    drawImage: vi.fn(),
    fillText: vi.fn(),
    textBaseline: '',
    textAlign: '',
    fillStyle: '',
    font: '',
  };

  drawSocialImage(context, { naturalWidth: 1200, naturalHeight: 630 });

  expect(context.font).toBe('700 52px "Pretendard Variable"');
  expect(context.fillStyle).toBe('#161616');
  expect(context.fillText).toHaveBeenCalledExactlyOnceWith('Cursor Cat', 56, 82);
});
