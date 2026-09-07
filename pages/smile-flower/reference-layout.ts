// Fixed six-column staggered arrangement from the supplied 720 × 1280 reference.
export const REFERENCE_WIDTH = 12;
export const REFERENCE_HEIGHT = 1280 / 60;

export const PALETTE = {
  B: '#4c9ff4', I: '#b1c9ed', G: '#00d071', Y: '#ffbd4d',
  R: '#f83c42', P: '#ef55b5', L: '#bbdf60', W: '#d4cce4',
} as const;

export const CORE_PALETTE = {
  B: '#2666b8', I: '#849bbe', G: '#00a347', Y: '#e99d23',
  R: '#cc0829', P: '#e46cad', L: '#97bc46', W: '#a596af',
} as const;

const centers = [
  'BBYBGY',
  'RPYBBIB',
  'BBYPRG',
  'WRIRGYI',
  'LRRPII',
  'YRPGWLY',
  'RWBYLY',
  'WWBPGGB',
  'BYRGPG',
  'BBGGYII',
  'WGIWIY',
  'LBYWWGR',
  'RGGIBR',
];
const porcelain = [
  'PWWPWW',
  'PWWPPWP',
  'PPWWRR',
  'WWWWWWW',
  'WWWWWW',
  'RWWRWWW',
  'WWPWWW',
  'WWPWRWP',
  'PPWRWR',
  'RPWWWWW',
  'WRWWWW',
  'WPWRWRR',
  'PWRWPW',
];

export const PETAL_PALETTE = { W: '#e8d0e3', R: '#e7bfd9', P: '#f396ca' } as const;

export const CELLS = centers.flatMap((row, r) => [...row].map((color, c) => ({
  x: ((r % 2 ? 0 : 60) + c * 120 - 360) / 60,
  y: (640 - (30 + r * 102)) / 60,
  color: color as keyof typeof PALETTE,
  porcelain: porcelain[r][c] as keyof typeof PETAL_PALETTE,
})));
