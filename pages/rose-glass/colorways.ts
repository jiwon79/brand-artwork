export const colorways = [
  { id: 'rose', label: 'Rose', swatch: '#d98c98', background: '#dab8be', ink: '#593d44' },
  { id: 'yellow', label: 'Yellow', swatch: '#dbc75a', background: '#d9d0b9', ink: '#514b32' },
  { id: 'green', label: 'Green', swatch: '#79bb5b', background: '#c7d9bd', ink: '#36513a' },
  { id: 'blue', label: 'Blue', swatch: '#7dbbd5', background: '#c7d3e5', ink: '#36516a' },
  { id: 'black', label: 'Black', swatch: '#858f8f', background: '#d1d1d1', ink: '#3e4849' },
  { id: 'orange', label: 'Orange', swatch: '#df865b', background: '#ead0bd', ink: '#624435' },
  { id: 'lilac', label: 'Lilac', swatch: '#a98acb', background: '#d8cbe5', ink: '#504263' },
  { id: 'teal', label: 'Teal', swatch: '#4ba59e', background: '#bcd9d5', ink: '#315956' },
  { id: 'pearl', label: 'Pearl', swatch: '#eee8dd', background: '#dfdcd5', ink: '#514b43' },
  { id: 'navy', label: 'Deep Navy', swatch: '#293e65', background: '#25324d', ink: '#e9eef8' },
] as const;

export type ColorwayId = typeof colorways[number]['id'];

export function colorwayIndex(value: string | null): number {
  const index = colorways.findIndex(colorway => colorway.id === value);
  return index < 0 ? 0 : index;
}
