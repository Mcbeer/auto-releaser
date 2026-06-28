// The single-action lifecycle, internalized (replaces the old two-workflow split).
// Pure w.r.t. GitHub: takes a GitHubGateway + an event descriptor, so it is fully
// testable with a fake gateway. The action entrypoint wires the real Octokit impl.

import type { ProjectResult } from "../orchestrate.ts";
import type { TrackedProject } from "../types.ts";
import type { GitHubGateway } from "./gateway.ts";

export type ActionEvent =
  | { kind: "push"; baseBranch: string }
  | { kind: "release_pr_merged"; headRef: string; mergeSha: string };

const RELEASE_BRANCH_PREFIX = "release/";

/** Branch name for a project's rolling release PR. */
export function releaseBranch(tagPrefix: string): string {
  return `${RELEASE_BRANCH_PREFIX}${tagPrefix}`;
}

/** Is this merged PR one of our release PRs? (release/<prefix>) */
export function isReleaseBranch(headRef: string): boolean {
  return headRef.startsWith(RELEASE_BRANCH_PREFIX);
}

/**
 * True if a push HEAD commit is one of our own release commits. The push that
 * results from merging a release PR must NOT trigger another bump (it would
 * re-bump on top of an un-tagged release commit — verified drift bug). The tag
 * is created by the pull_request:closed handler instead.
 */
export function isReleaseCommit(headCommitMessage: string): boolean {
  return headCommitMessage.startsWith("chore(release):");
}

/**
 * On push to the base branch: for each changed project, upsert its rolling
 * release PR (scoped to only that project's files). Returns the PRs touched.
 */
export async function handlePush(
  gw: GitHubGateway,
  baseBranch: string,
  results: readonly ProjectResult[],
): Promise<{ tagPrefix: string; prNumber: number }[]> {
  const touched: { tagPrefix: string; prNumber: number }[] = [];

  for (const r of results) {
    if (r.release === null) continue;
    const head = releaseBranch(r.tagPrefix);
    const version = r.release.nextVersion;

    const { number } = await gw.upsertPullRequest({
      headBranch: head,
      baseBranch,
      title: `chore(release): ${r.tagPrefix} ${version}`,
      body: r.notes,
      // Only this project's files — paths are guaranteed non-overlapping.
      files: [`${r.projectPath}/package.json`, `${r.projectPath}/CHANGELOG.md`],
      commitMessage: `chore(release): ${r.tagPrefix} ${version}`,
      labels: ["release"],
    });
    touched.push({ tagPrefix: r.tagPrefix, prNumber: number });
  }
  return touched;
}

/**
 * On a merged release PR: resolve which tracked project it was, read its version,
 * and create the tag + release (idempotent if the tag already exists).
 */
export async function handleReleasePrMerged(
  gw: GitHubGateway,
  event: { headRef: string; mergeSha: string },
  projects: readonly TrackedProject[],
  readVersion: (projectPath: string) => string,
): Promise<{ tag: string; created: boolean } | null> {
  if (!isReleaseBranch(event.headRef)) return null;

  const tagPrefix = event.headRef.slice(RELEASE_BRANCH_PREFIX.length);
  const project = projects.find((p) => p.tagPrefix === tagPrefix);
  if (project === undefined) {
    throw new Error(`Merged release branch "${event.headRef}" has no matching tracked project.`);
  }

  const version = readVersion(project.path);
  const tag = `${tagPrefix}-v${version}`;

  if (await gw.tagExists(tag)) return { tag, created: false };

  // Use the project's grouped changelog notes if available — but on merge we read
  // from the merged files; the caller supplies notes via the CHANGELOG. Keep the
  // release body minimal here; richer notes can be threaded later.
  await gw.createTagAndRelease(tag, event.mergeSha, `Release ${tag}.`);
  return { tag, created: true };
}
