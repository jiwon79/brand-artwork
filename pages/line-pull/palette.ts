export interface RevealTheme {
  panelColor: string;
  textColor: string;
}

export const revealPalette: readonly RevealTheme[] = [
  { panelColor: '#c61f3f', textColor: '#f4f0df' }, // Red
  { panelColor: '#d6df45', textColor: '#171811' }, // Acid yellow
  { panelColor: '#3555cc', textColor: '#f4f0df' }, // Cobalt blue
  { panelColor: '#aa94c7', textColor: '#171811' }, // Dusty lilac
  { panelColor: '#88b5a0', textColor: '#171811' }, // Sage mint
];

// Select once at line activation; movement and spring return keep the same pair.
export function themeForInteraction(index: number): RevealTheme {
  return revealPalette[index % revealPalette.length];
}
