import { fragmentSource } from '../../../pages/rose-glass/shader';

type Pair = readonly [number, number];
type RGB = readonly [number, number, number];
export type ShadingRegion = { label: string; operation: 'mix' | 'add' | 'subtract'; color: RGB; center: Pair; radius: Pair; strength: number };

/** Read the eight color-region operations from the production shader, in order. */
export function parseShadingRegions(source: string): ShadingRegion[] {
  const start = source.indexOf('    color = vec3(.945,.559,.550);');
  const end = source.indexOf('  } else {\n    // Independent rear materials', start);
  if (start < 0 || end < 0) throw new Error('앞쪽 유리의 색 영역을 찾을 수 없습니다.');
  const labels = ['오른쪽 위 · 연분홍', '왼쪽 아래 · 밝은 살구', '오른쪽 아래 · 살구', '왼쪽 위 · 붉은 분홍', '위쪽 · 짙은 붉은색', '오른쪽 · 밝기 더하기', '오른쪽 · 어둠 더하기', '아래 끝 · 어둠 더하기'];
  const regions = source.slice(start, end).split('\n').filter(line => line.includes('bell(') && /^\s*color\s*(?:= mix|[+-]=)/.test(line)).map((line, index) => {
    const vectors = [...line.matchAll(/vec([23])\(([^)]+)\)/g)].map(match => match[2].split(',').map(Number));
    if (vectors.length !== 3 || vectors[0].length !== 3 || vectors[1].length !== 2 || vectors[2].length !== 2 || vectors.some(values => values.some(value => !Number.isFinite(value)))) throw new Error('색 영역의 계산 형식을 확인하세요.');
    return { label: `${index + 1}. ${labels[index]}`, operation: line.includes('= mix') ? 'mix' : line.includes('+=') ? 'add' : 'subtract',
      color: vectors[0] as unknown as RGB, center: vectors[1] as unknown as Pair, radius: vectors[2] as unknown as Pair,
      strength: Number(/\)\*([\d.]+)\);/.exec(line)?.[1] ?? 1) } satisfies ShadingRegion;
  });
  if (regions.length !== 8) throw new Error('색 영역의 개수가 바뀌었습니다. 설명을 확인하세요.');
  return regions;
}
export const shadingRegions = parseShadingRegions(fragmentSource);
export function shadingRegionWeight(index: number, u: number, v: number) {
  const region = shadingRegions[index];
  return Math.exp(-2 * (((u - region.center[0]) / region.radius[0]) ** 2 + ((v - region.center[1]) / region.radius[1]) ** 2)) * region.strength;
}
export function colorHex(color: RGB) {
  return `#${color.map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('')}`;
}
