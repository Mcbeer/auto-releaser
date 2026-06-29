// Core contracts. See EXTENSIBILITY-DESIGN.md §3.
// All interfaces here are the public-shaped seams; the closure algorithm is NOT a seam (shared).

/** Read-only git access. A capability interface so it stays mockable + additive. */
export interface GitReader {
  /**
   * Commits since `sinceRef` (exclusive). One entry per squash commit, each
   * carrying its full message AND the files it touched — everything attribution
   * needs in a single call (no per-commit round-trip).
   */
  log(sinceRef: string | null): Promise<readonly CommitInfo[]>;
  /** Most recent tag matching `prefix-v*`, or null if none. */
  lastTag(prefix: string): Promise<string | null>;
}

export interface CommitInfo {
  readonly sha: string;
  /** Full commit message (subject + body). Body is needed for BREAKING CHANGE footer. */
  readonly message: string;
  /** Repo-relative file paths touched by this commit. */
  readonly changedPaths: readonly string[];
}

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
}

export interface TrackedProject {
  readonly path: string; // repo-relative
  readonly tagPrefix: string;
  /**
   * Extra repo-relative globs to include in this project's release PR commit,
   * beyond package.json + CHANGELOG.md (e.g. built artifacts like "dist/**").
   * Mirrors release-please's extra-files. Optional.
   */
  readonly extraFiles?: readonly string[];
}

export interface ReleaseConfig {
  readonly resolver: string; // registry key, e.g. "pnpm"
  readonly changelogRenderer: string; // registry key, e.g. "grouped-by-package"
  readonly trackedProjects: readonly TrackedProject[];
  readonly commitTypes: Readonly<Record<string, "major" | "minor" | "patch">>;
  /** Whether devDependency edges count toward the bundled closure. */
  readonly includeDev: boolean;
}

/** Ambient toolkit passed to every seam. Immutable; grows additively. */
export interface ReleaseContext {
  readonly repoRoot: string;
  readonly config: ReleaseConfig;
  readonly logger: Logger;
  readonly git: GitReader;
}

// --- Seam 1: WorkspaceGraphProvider ------------------------------------------
// The adapter ONLY reports the raw internal graph. It does NOT compute closures.

export interface WorkspacePackage {
  readonly name: string;
  readonly dir: string; // absolute path
  readonly internalDeps: readonly string[]; // prod, internal package names
  readonly internalDevDeps: readonly string[]; // dev, internal package names
}

export interface WorkspaceGraph {
  readonly packages: readonly WorkspacePackage[];
}

export interface WorkspaceGraphProvider {
  readonly name: string;
  readWorkspaceGraph(ctx: ReleaseContext): Promise<WorkspaceGraph>;
}

// --- Seam 2: ChangelogRenderer -----------------------------------------------

export type Bump = "major" | "minor" | "patch";

export interface AttributedCommit {
  readonly subject: string;
  readonly bump: Bump;
  /** Internal package whose change pulled this commit into the project. */
  readonly sourcePackage: string;
}

export interface ComputedRelease {
  readonly project: TrackedProject;
  readonly nextVersion: string;
  readonly bump: Bump;
  readonly commits: readonly AttributedCommit[];
}

export interface ChangelogRenderer {
  readonly name: string;
  render(release: ComputedRelease, ctx: ReleaseContext): string;
}
// dogfood feature
// trigger real self-release to verify branch name
