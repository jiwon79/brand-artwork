import { expect, test, vi } from 'vitest';
import { drawSocialImage, socialImage } from './line-pull-social-image.mjs';

const context = () => ({
  canvas: { width: 0, height: 0 },
  drawImage: vi.fn<(source: Pick<HTMLImageElement, 'naturalWidth' | 'naturalHeight'>, x: number, y: number) => void>(),
  fillRect: vi.fn<CanvasRenderingContext2D['fillRect']>(),
  createLinearGradient: vi.fn<(x0: number, y0: number, x1: number, y1: number) => Pick<CanvasGradient, 'addColorStop'>>(
    () => ({ addColorStop: vi.fn<CanvasGradient['addColorStop']>() }),
  ),
  fillText: vi.fn<CanvasRenderingContext2D['fillText']>(),
});

test('compose the title and episode above the greeting without rescaling the capture', () => {
  const ctx = context();
  const source = { naturalWidth: 1200, naturalHeight: 630 };
  drawSocialImage(ctx, source);
  expect(ctx.canvas).toEqual({ width: 1200, height: 630 });
  expect(ctx.drawImage).toHaveBeenCalledExactlyOnceWith(source, 0, 0);
  expect(ctx.fillRect).toHaveBeenCalledExactlyOnceWith(0, 0, 1200, 144);
  expect(socialImage.headingHeight).toBeLessThan(155);
  expect(ctx.fillText.mock.calls).toEqual([
    ['Line Pull', 56, 82],
    ['바이브코딩으로 예쁜 거 만들기 · 4일차', 1144, 79],
  ]);
});

test('reject differently sized captures instead of stretching the artwork', () => {
  for (const [naturalWidth, naturalHeight] of [[2400, 1260], [1200, 800], [0, 0]]) {
    const ctx = context();
    expect(() => drawSocialImage(ctx, { naturalWidth, naturalHeight })).toThrow('1200 × 630');
    expect(ctx.drawImage).not.toHaveBeenCalled();
  }
});
