import { expect, test, vi } from 'vitest';
import { drawSocialImage, socialImage } from './smile-flower-social-image.mjs';

test('uses the standard Smile Flower title typography and position', () => {
  const context = {
    canvas: { width: 0, height: 0 },
    drawImage: vi.fn(),
    measureText: vi.fn(() => ({ width: 320 })),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    textBaseline: '',
    textAlign: '',
    fillStyle: '',
    font: '',
  };

  drawSocialImage(context, { naturalWidth: 1200, naturalHeight: 630 });

  expect(context.font).toBe('700 52px "Pretendard Variable"');
  expect(context.fillStyle).toBe('#161616');
  expect(socialImage.labelBackground).toBe('rgba(255, 255, 255, 0.92)');
  expect(context.roundRect).toHaveBeenCalledExactlyOnceWith(32, 24, 368, 82, 16);
  expect(context.fill).toHaveBeenCalledOnce();
  expect(context.fillText).toHaveBeenCalledExactlyOnceWith('Smile Flower', 56, 82);
});
