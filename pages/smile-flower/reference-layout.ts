// Fixed six-column staggered arrangement from the supplied 720 × 1280 reference.
export const REFERENCE_WIDTH = 12;
export const REFERENCE_HEIGHT = 1280 / 60;

export const PALETTE = {
  B: '#4c9ff4', I: '#b1c9ed', G: '#00d071', Y: '#ffbd4d',
  R: '#f83c42', P: '#ef55b5', L: '#bbdf60', W: '#d4cce4',
} as const;

export const CORE_PALETTE = {
  B: '#5486bb', I: '#99acc7', G: '#4fab80', Y: '#d9ac55',
  R: '#c86479', P: '#d399be', L: '#adc777', W: '#b4a6ba',
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

export const PETAL_PALETTE = { W: '#e5d6e3', R: '#dfc5d8', P: '#e4aecb' } as const;

export const CELLS = centers.flatMap((row, r) => [...row].map((color, c) => ({
  x: ((r % 2 ? 0 : 60) + c * 120 - 360) / 60,
  y: (640 - (30 + r * 102)) / 60,
  color: color as keyof typeof PALETTE,
  porcelain: porcelain[r][c] as keyof typeof PETAL_PALETTE,
})));
