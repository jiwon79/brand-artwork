export const colorways = [
  { id: 'rose', label: 'Rose', swatch: '#d98c98', background: '#dab8be', ink: '#593d44' },
  { id: 'yellow', label: 'Yellow', swatch: '#dbc75a', background: '#d9d0b9', ink: '#514b32' },
  { id: 'green', label: 'Green', swatch: '#79bb5b', background: '#c7d9bd', ink: '#36513a' },
  { id: 'blue', label: 'Blue', swatch: '#7dbbd5', background: '#c7d3e5', ink: '#36516a' },
  { id: 'black', label: 'Black', swatch: '#858f8f', background: '#d1d1d1', ink: '#3e4849' },
] as const;

export type ColorwayId = typeof colorways[number]['id'];

export function colorwayIndex(value: string | null): number {
  const index = colorways.findIndex(colorway => colorway.id === value);
  return index < 0 ? 0 : index;
}
