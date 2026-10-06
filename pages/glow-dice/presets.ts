const studio = {
  diceColor: '#56575a', pipColor: '#fafaff', backgroundColor: '#030304', lightColor: '#f9faff',
  exposure: 0.36, softboxIntensity: 2.1, keyIntensity: 0.22, fillIntensity: 0.08, ambientIntensity: 0.12,
  light: 3, glow: 0.18, roughness: 0.4, clearcoat: 0.75, environment: 0.55,
};
export const COLOR_PRESETS = {
  '차콜 · 기본': studio,
  '코발트 · 아이스': { ...studio, diceColor: '#294785', pipColor: '#8ce7ff', backgroundColor: '#020713', lightColor: '#bfd8ff', glow: 0.27 },
  '브론즈 · 앰버': { ...studio, diceColor: '#805238', pipColor: '#ffd68b', backgroundColor: '#100805', lightColor: '#ffe2bd', roughness: 0.32, glow: 0.25 },
  '제이드 · 민트': { ...studio, diceColor: '#286451', pipColor: '#a0ffda', backgroundColor: '#020b08', lightColor: '#d8fff0', glow: 0.23 },
  '바이올렛 · 핑크': { ...studio, diceColor: '#624680', pipColor: '#ffb4ef', backgroundColor: '#090412', lightColor: '#e9d3ff', glow: 0.3 },
  '포슬린 · 화이트': { ...studio, diceColor: '#d9d6cc', pipColor: '#fff0c9', backgroundColor: '#36332d', lightColor: '#fff5e1', exposure: 1.15, light: 1.1, glow: 0.1, roughness: 0.5, clearcoat: 0.4 },
};
export type ColorPreset = keyof typeof COLOR_PRESETS;
