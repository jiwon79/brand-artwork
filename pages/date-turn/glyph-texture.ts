import * as THREE from 'three';
import { encodeDistance, signedDistance } from './distance-field';

export const FIELD_SPAN = 4.6;
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
  const cap = context.measureText('00');
  let fontSize = 1.72 / FIELD_SPAN * RESOLUTION * 100 / (cap.actualBoundingBoxAscent + cap.actualBoundingBoxDescent);
  const baseFontSize = fontSize;
  context.font = `800 ${fontSize}px ${fontFamily}, DateTurnNumerals, sans-serif`;
  let bounds = context.measureText(text);
  const maximumWidth = 2.85 / FIELD_SPAN * RESOLUTION;
  const textWidth = bounds.actualBoundingBoxLeft + bounds.actualBoundingBoxRight;
  if (textWidth > maximumWidth) {
    fontSize *= maximumWidth / textWidth;
    context.font = `800 ${fontSize}px ${fontFamily}, DateTurnNumerals, sans-serif`;
    bounds = context.measureText(text);
  }
  context.fillStyle = '#ffffff';
  context.fillText(text,
    RESOLUTION / 2 - (bounds.actualBoundingBoxRight - bounds.actualBoundingBoxLeft) / 2,
    RESOLUTION / 2 + (bounds.actualBoundingBoxAscent - bounds.actualBoundingBoxDescent) / 2);
  const rgba = context.getImageData(0, 0, RESOLUTION, RESOLUTION).data;
  const mask = new Uint8Array(RESOLUTION * RESOLUTION);
  for (let y = 0; y < RESOLUTION; y++) for (let x = 0; x < RESOLUTION; x++) {
    mask[(RESOLUTION - 1 - y) * RESOLUTION + x] = rgba[(y * RESOLUTION + x) * 4 + 3] >= 128 ? 1 : 0;
  }
  const data = encodeDistance(signedDistance(mask, RESOLUTION, RESOLUTION), FIELD_SPAN / RESOLUTION, FIELD_SPAN);
  const texture = new THREE.DataTexture(data, RESOLUTION, RESOLUTION, THREE.RGBAFormat);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.userData.inkScale = fontSize / baseFontSize;
  texture.needsUpdate = true;
  return texture;
}
