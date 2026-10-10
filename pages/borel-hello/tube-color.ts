import { Color, MeshPhysicalMaterial, MeshStandardMaterial, type Texture } from 'three';
import { gradientPieces } from './gradient-ink';
import type { PenPath } from './pen-geometry';

export type TubeFinish = 'solid' | 'matte-rainbow' | 'glossy-rainbow';
export const tubeRainbowPalette = ['#1686ff', '#7135e8', '#d715c4', '#f51d60', '#ff7018', '#f3cd16', '#70ce29', '#00b6a0'];

/** Reuse the body/mark anchors from the ink gradient with a vivid 3D palette.
 * Each ring has one fixed linear-light color. Surface normals and view angle
 * change its shading, never its place in the spectrum. */
export function createTubeColors(pens: readonly PenPath[]): Color[][] {
  return gradientPieces(pens, tubeRainbowPalette).map((pieces, index) => {
    if (!pieces.length) return pens[index].points.map(() => new Color(0xffffff));
    return [new Color(pieces[0].from), ...pieces.map(piece => new Color(piece.to))].slice(0, pens[index].points.length);
  });
}

export function createMatteTubeMaterial(vertexColors = false) {
  return new MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, vertexColors });
}

export function createGlossyTubeMaterial(environment: Texture, vertexColors = false) {
  return new MeshPhysicalMaterial({
    color: 0xffffff, vertexColors, roughness: .24, metalness: .02,
    clearcoat: 1, clearcoatRoughness: .14, ior: 1.46,
    envMap: environment, envMapIntensity: .8,
  });
}
