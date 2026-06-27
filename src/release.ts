// Per-project release computation: given the commits since the project's last
// tag and its closure, attribute commits, compute the max bump, and the next
// version. Pure function — no git/IO here (callers supply CommitInfo + closure).

import type {
  AttributedCommit,
  CommitInfo,
  ComputedRelease,
  ReleaseConfig,
  TrackedProject,
} from "./types.ts";
import { parseCommit, commitBump } from "./commit.ts";
import { maxBump, applyBump } from "./bump.ts";
import { attributeCommit, type ClosureEntry } from "./attribution.ts";

export interface ComputeInput {
  readonly project: TrackedProject;
  readonly currentVersion: string;
  readonly commits: readonly CommitInfo[];
  /** The project's transitive closure as repo-relative entries (own folder included). */
  readonly closure: readonly ClosureEntry[];
  readonly config: ReleaseConfig;
}

/** Returns the computed release, or null if no attributed commit yields a bump. */
export function computeRelease(input: ComputeInput): ComputedRelease | null {
  const { project, currentVersion, commits, closure, config } = input;

  const attributed: AttributedCommit[] = [];
  for (const commit of commits) {
    const sources = attributeCommit(commit.changedPaths, closure);
    if (sources.size === 0) continue; // not in this project's closure

    const parsed = parseCommit(commit.message);
    const bump = commitBump(parsed, config);
    if (bump === null) continue; // no-bump type (docs, chore, non-conforming)

    // Source package: pick deterministically (first sorted) for changelog grouping.
    const sourcePackage = [...sources].sort()[0]!;
    attributed.push({ subject: parsed.description, bump, sourcePackage });
  }

  const bump = maxBump(attributed.map((c) => c.bump));
  if (bump === null) return null; // no-op: emit nothing (parent doc §8.4)

  return {
    project,
    nextVersion: applyBump(currentVersion, bump),
    bump,
    commits: attributed,
  };
}
