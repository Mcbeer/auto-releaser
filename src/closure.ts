import type { WorkspaceGraph } from "./types.ts";

// Shared, package-manager-agnostic transitive closure. NOT a seam.
// Cycle-safe via visited-set (verified terminating on a games<->util cycle).
// The prod/dev policy lives HERE, not in the PM adapter, so every resolver
// computes identical closures for the same repo.
export function resolveClosure(
  graph: WorkspaceGraph,
  root: string,
  opts: { includeDev: boolean },
): Set<string> {
  const byName = new Map(graph.packages.map((p) => [p.name, p]));
  const seen = new Set<string>();
  const stack = [root];

  while (stack.length > 0) {
    const name = stack.pop()!;
    if (seen.has(name)) continue; // guard: makes cycles safe
    seen.add(name);

    const node = byName.get(name);
    if (node === undefined) continue;

    const edges = opts.includeDev
      ? [...node.internalDeps, ...node.internalDevDeps]
      : node.internalDeps;
    for (const dep of edges) stack.push(dep);
  }

  return seen;
}

/** Map a closure of package names to their absolute folder paths. */
export function closureDirs(graph: WorkspaceGraph, closure: Set<string>): string[] {
  const dirs: string[] = [];
  for (const p of graph.packages) {
    if (closure.has(p.name)) dirs.push(p.dir);
  }
  return dirs;
}
