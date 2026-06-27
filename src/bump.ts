import type { Bump } from "./types.ts";

const RANK: Record<Bump, number> = { patch: 1, minor: 2, major: 3 };

/** Highest bump across the inputs; null if there are no bumps at all. */
export function maxBump(bumps: readonly (Bump | null)[]): Bump | null {
  let best: Bump | null = null;
  for (const b of bumps) {
    if (b === null) continue;
    if (best === null || RANK[b] > RANK[best]) best = b;
  }
  return best;
}

/** Apply a bump to a semver string. Pre-release/build metadata is not handled (YAGNI). */
export function applyBump(version: string, bump: Bump): string {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (m === null) throw new Error(`Not a plain semver version: "${version}"`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  switch (bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}
