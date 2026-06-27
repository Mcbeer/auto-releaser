// Attribution: does a commit belong to a project's release?
// Rule (parent doc §4.1.5): a commit is attributed to a project if any file it
// touched lives within that project's dependency closure (own folder included).
//
// The commit's source package = the closure package whose folder contains the
// touched file, so the changelog can group "where each change came from".

import { relative, sep } from "node:path";
import { realpathSync } from "node:fs";

/** A closure package as (name, repo-relative folder). */
export interface ClosureEntry {
  readonly name: string;
  readonly relDir: string; // repo-relative, posix-style, no leading "./"
}

/** True if repo-relative file `path` is inside repo-relative folder `dir`. */
function isWithin(path: string, dir: string): boolean {
  if (dir === "" || dir === ".") return true; // repo root contains everything
  if (path === dir) return true;
  return path.startsWith(dir.endsWith("/") ? dir : dir + "/");
}

/**
 * For a single commit's changed paths, return the set of closure package names
 * that "own" at least one changed file. Empty set = commit not attributed.
 *
 * If a file matches multiple closure folders (e.g. nested packages), the most
 * specific (longest matching folder) wins — that's the true source package.
 */
export function attributeCommit(
  changedPaths: readonly string[],
  closure: readonly ClosureEntry[],
): Set<string> {
  // Pre-sort by folder length desc so the first match per file is the deepest.
  const sorted = [...closure].sort((a, b) => b.relDir.length - a.relDir.length);
  const sources = new Set<string>();

  for (const path of changedPaths) {
    for (const entry of sorted) {
      if (isWithin(path, entry.relDir)) {
        sources.add(entry.name);
        break; // deepest match only
      }
    }
  }
  return sources;
}

/**
 * Convert absolute closure dirs to repo-relative posix entries for attribution.
 *
 * Resolves both sides through realpath first: pnpm reports package paths in
 * canonical form (e.g. macOS /var -> /private/var; symlinked workspaces), which
 * would otherwise produce a broken `../../..` relative path against an
 * unresolved repoRoot and silently break attribution. Verified against a real
 * fixture where the naive relative() yielded garbage and matched nothing.
 */
export function toClosureEntries(
  repoRoot: string,
  pkgs: readonly { name: string; dir: string }[],
): ClosureEntry[] {
  const root = realIfExists(repoRoot);
  return pkgs.map((p) => ({
    name: p.name,
    relDir: relative(root, realIfExists(p.dir)).split(sep).join("/"),
  }));
}

/** realpath if the path exists on disk; otherwise return as-is (keeps pure tests working). */
function realIfExists(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}
