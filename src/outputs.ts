// Build the GitHub Actions output block from project results. Pure (returns a
// string) so it's testable without spawning the CLI; the CLI does the IO.

import type { ProjectResult } from "./orchestrate.ts";

export function buildOutputs(results: readonly ProjectResult[]): string {
  const changed = results.filter((r) => r.release !== null);
  const lines: string[] = [`hasChanges=${changed.length > 0}`];

  // Machine-readable list driving the workflow matrix (one PR per changed
  // project), INCLUDING changelog notes. JSON.stringify escapes newlines so the
  // multiline notes survive a single-line GITHUB_OUTPUT value and are recovered
  // intact by fromJSON in the matrix; matrix.project.notes becomes the PR body.
  const changedProjects = changed.map((r) => ({
    tagPrefix: r.tagPrefix,
    path: r.projectPath,
    version: r.release!.nextVersion,
    notes: r.notes.trimEnd(),
  }));
  lines.push(`changedProjects=${JSON.stringify(changedProjects)}`);

  // Per-project keys too (handy for single-project workflows / debugging).
  for (const r of changed) {
    lines.push(`${r.tagPrefix}_version=${r.release!.nextVersion}`);
    const delim = `NOTES_${r.tagPrefix}_EOF`;
    lines.push(`${r.tagPrefix}_notes<<${delim}`, r.notes.trimEnd(), delim);
  }

  return lines.join("\n") + "\n";
}
