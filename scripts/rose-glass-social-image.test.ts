import { expect, test, vi } from 'vitest';
import { drawSocialImage, socialImage } from './rose-glass-social-image.mjs';

test('uses the standard Rose Glass title treatment and position', () => {
  const context = {
    canvas: { width: 0, height: 0 },
    drawImage: vi.fn(),
    save: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    restore: vi.fn(),
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

  expect(context.translate).toHaveBeenCalledExactlyOnceWith(600, 315);
  expect(context.rotate).toHaveBeenCalledExactlyOnceWith(Math.PI / 2);
  expect(context.drawImage).toHaveBeenCalledExactlyOnceWith(
    expect.anything(),
    441,
    32,
    318,
    566,
    expect.closeTo(-337.102, 2),
    -600,
    expect.closeTo(674.205, 2),
    1200,
  );
  expect(context.font).toBe('700 52px "Pretendard Variable"');
  expect(context.fillStyle).toBe('#593d44');
  expect(socialImage.labelBackground).toBe('rgba(255, 255, 255, 0.92)');
  expect(context.roundRect).toHaveBeenCalledExactlyOnceWith(32, 24, 308, 82, 16);
  expect(context.fill).toHaveBeenCalledOnce();
  expect(context.fillText).toHaveBeenCalledExactlyOnceWith('Rose Glass', 56, 82);
});
