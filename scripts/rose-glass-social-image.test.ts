import { expect, test, vi } from 'vitest';
import { drawSocialImage, socialImage } from './rose-glass-social-image.mjs';

test('uses the standard Rose Glass title treatment and position', () => {
  const context = {
    canvas: { width: 0, height: 0 },
    drawImage: vi.fn(),
    measureText: vi.fn(() => ({ width: 260 })),
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
  expect(context.fillStyle).toBe('#593d44');
  expect(socialImage.labelBackground).toBe('rgba(255, 255, 255, 0.92)');
  expect(context.roundRect).toHaveBeenCalledExactlyOnceWith(32, 24, 308, 82, 16);
  expect(context.fill).toHaveBeenCalledOnce();
  expect(context.fillText).toHaveBeenCalledExactlyOnceWith('장밋빛 유리', 56, 82);
});
