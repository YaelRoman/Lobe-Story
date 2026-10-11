import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

it('uses no browser pop-ups (they are blocked in the artifact viewer)', () => {
  const offenders = sources(path.resolve(process.cwd(), 'src')).filter((f) =>
    /window\.(confirm|prompt|alert)\(/.test(readFileSync(f, 'utf8')),
  );
  expect(offenders).toEqual([]);
});
