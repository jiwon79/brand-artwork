import * as THREE from 'three';
import { encodeDistance, signedDistance } from './distance-field';

export const FIELD_SPAN = 4.6;
export const GLYPH_HEIGHT = 1.72;
export const GLYPH_MAX_WIDTH = 2.85;
const RESOLUTION = 768;

export async function loadNumeralFont(): Promise<void> {
  const source = new URL('../line-pull/assets/Pretendard-ExtraBold.subset.woff2', import.meta.url).href;
  const font = new FontFace('DateTurnNumerals', `url(${source})`, { weight: '800' });
  document.fonts.add(await font.load());
}

/** Font input is regenerated only when a number changes, never from video frames. */
export function createGlyphTexture(text: string, fontFamily = 'Arial Black'): THREE.DataTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = RESOLUTION;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.font = `800 100px ${fontFamily}, DateTurnNumerals, sans-serif`;
  const cap = context.measureText(text);
  const fontSize = GLYPH_HEIGHT / FIELD_SPAN * RESOLUTION * 100 / (cap.actualBoundingBoxAscent + cap.actualBoundingBoxDescent);
  context.font = `800 ${fontSize}px ${fontFamily}, DateTurnNumerals, sans-serif`;
  const bounds = context.measureText(text);
  const maximumWidth = GLYPH_MAX_WIDTH / FIELD_SPAN * RESOLUTION;
  const textWidth = bounds.actualBoundingBoxLeft + bounds.actualBoundingBoxRight;
  // Fit long labels horizontally without shrinking their height.
  const widthScale = Math.min(1, maximumWidth / textWidth);
  context.translate(RESOLUTION / 2, RESOLUTION / 2);
  context.scale(widthScale, 1);
  context.fillStyle = '#ffffff';
  context.fillText(text,
    -(bounds.actualBoundingBoxRight - bounds.actualBoundingBoxLeft) / 2,
    (bounds.actualBoundingBoxAscent - bounds.actualBoundingBoxDescent) / 2);
  const rgba = context.getImageData(0, 0, RESOLUTION, RESOLUTION).data;
  const mask = new Uint8Array(RESOLUTION * RESOLUTION);
  for (let y = 0; y < RESOLUTION; y++) for (let x = 0; x < RESOLUTION; x++) {
    mask[(RESOLUTION - 1 - y) * RESOLUTION + x] = rgba[(y * RESOLUTION + x) * 4 + 3] >= 128 ? 1 : 0;
  }
  const data = encodeDistance(signedDistance(mask, RESOLUTION, RESOLUTION), FIELD_SPAN / RESOLUTION, FIELD_SPAN);
  const texture = new THREE.DataTexture(data, RESOLUTION, RESOLUTION, THREE.RGBAFormat);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.userData.inkScale = widthScale;
  texture.needsUpdate = true;
  return texture;
}
