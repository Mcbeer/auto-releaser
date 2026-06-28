// GitHub integration boundary. The pure core (orchestrate/release/...) never
// imports this or Octokit; the action lifecycle drives the API through this
// interface so it stays mockable. The concrete Octokit impl is in octokit.ts.

export interface PullRequestUpsert {
  /** Branch the PR is opened from, e.g. "release/kc-bff". */
  readonly headBranch: string;
  readonly baseBranch: string;
  readonly title: string;
  readonly body: string;
  /** Files (repo-relative) to commit on the head branch — only this project's. */
  readonly files: readonly string[];
  readonly commitMessage: string;
  readonly labels: readonly string[];
}

export interface MergedReleasePR {
  /** Head branch of the merged PR, e.g. "release/kc-bff". */
  readonly headRef: string;
  /** The merge commit SHA on the base branch. */
  readonly mergeSha: string;
}

export interface GitHubGateway {
  /**
   * Create the rolling release PR, or update it if one already exists for
   * headBranch (idempotent — the release-please behaviour). Stages only `files`.
   */
  upsertPullRequest(pr: PullRequestUpsert): Promise<{ number: number; url: string }>;

  /** Create a lightweight tag at `sha` and a GitHub release with `notes`. */
  createTagAndRelease(tag: string, sha: string, notes: string): Promise<void>;

  /** True if a tag already exists (skip re-tagging — idempotent). */
  tagExists(tag: string): Promise<boolean>;
}
