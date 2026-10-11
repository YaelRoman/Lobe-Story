/** The minimal shape of a custom group that naming needs. */
interface Named {
  id: string;
  name: string;
}

/** `wanted`, or `wanted (2)`, `wanted (3)`… when another group (not `exceptId`) already has that name (compared ignoring case). */
export function uniqueGroupName(groups: Named[], wanted: string, exceptId?: string): string {
  const taken = new Set(groups.filter((g) => g.id !== exceptId).map((g) => g.name.toLowerCase()));
  if (!taken.has(wanted.toLowerCase())) return wanted;
  let n = 2;
  while (taken.has(`${wanted} (${n})`.toLowerCase())) n++;
  return `${wanted} (${n})`;
}
