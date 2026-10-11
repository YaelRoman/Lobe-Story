export const PALETTE = [
  '#4e79a7',
  '#f28e2b',
  '#e15759',
  '#76b7b2',
  '#59a14f',
  '#edc948',
  '#b07aa1',
  '#ff9da7',
  '#9c755f',
  '#bab0ac',
];

export function colorMap(ids: string[]): Map<string, string> {
  return new Map(ids.map((id, i) => [id, PALETTE[i % PALETTE.length]]));
}
