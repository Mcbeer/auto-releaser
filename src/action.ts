// GitHub Action entrypoint (bundled to dist/index.js by esbuild). Wires real
// event context + Octokit, then delegates to the pure lifecycle module. Single
// self-contained action: push → per-project release PRs; release-PR merge → tag.

import * as core from "@actions/core";
import * as github from "@actions/github";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.ts";
import { createGitReader } from "./git.ts";
import { resolvers, renderers } from "./builtins.ts";
import { run } from "./orchestrate.ts";
import { createOctokitGateway, type OctokitLike } from "./github/octokit.ts";
import { handlePush, handleReleasePrMerged, isReleaseCommit } from "./github/lifecycle.ts";
import type { ReleaseContext } from "./types.ts";

function readVersion(repoRoot: string, projectPath: string): string {
  const pkg = JSON.parse(readFileSync(join(repoRoot, projectPath, "package.json"), "utf8")) as { version?: string };
  if (typeof pkg.version !== "string") throw new Error(`${projectPath}/package.json has no version`);
  return pkg.version;
}

async function main(): Promise<void> {
  const repoRoot = process.env["GITHUB_WORKSPACE"] ?? process.cwd();
  const configPath = core.getInput("config") || "release.json";
  const token = core.getInput("token", { required: true });

  const config = loadConfig(join(repoRoot, configPath));
  const { owner, repo } = github.context.repo;
  const octokit = github.getOctokit(token) as unknown as OctokitLike;
  const gateway = createOctokitGateway(octokit, { owner, repo, repoRoot });

  const event = github.context.eventName;

  if (event === "pull_request") {
    // Tag step: only act on a MERGED release PR.
    const pr = github.context.payload.pull_request as
      | { merged?: boolean; head?: { ref?: string }; merge_commit_sha?: string }
      | undefined;
    if (pr?.merged !== true) {
      core.info("PR not merged; nothing to tag.");
      return;
    }
    const out = await handleReleasePrMerged(
      gateway,
      { headRef: pr.head?.ref ?? "", mergeSha: pr.merge_commit_sha ?? "" },
      config.trackedProjects,
      (p) => readVersion(repoRoot, p),
    );
    if (out === null) {
      core.info("Merged PR is not a release branch; ignoring.");
      core.setOutput("tagged", "false");
    } else {
      core.info(`${out.created ? "Created" : "Already exists"}: ${out.tag}`);
      // Emit so a self-hosting / action-publishing workflow can derive its own
      // floating-major + semver tags (e.g. v1, v1.2.3) from the native tag.
      core.setOutput("tagged", String(out.created));
      core.setOutput("tag", out.tag);
      const m = /-v(\d+)\.(\d+)\.(\d+)$/.exec(out.tag);
      if (m) {
        core.setOutput("version", `${m[1]}.${m[2]}.${m[3]}`);
        core.setOutput("major", m[1]!);
      }
    }
    return;
  }

  // push (default): run the tool, then upsert per-project release PRs.
  // Guard: skip our own release commits so merging a release PR doesn't re-bump
  // on top of an un-tagged release commit (the tag handler owns that commit).
  const headCommitMessage = (github.context.payload.head_commit as { message?: string } | undefined)?.message ?? "";
  if (isReleaseCommit(headCommitMessage)) {
    core.info("HEAD is a release commit; skipping (the tag step owns it).");
    core.setOutput("hasChanges", "false");
    return;
  }

  const ctx: ReleaseContext = {
    repoRoot,
    config,
    logger: { info: (m) => core.info(m), warn: (m) => core.warning(m) },
    git: createGitReader(repoRoot),
  };
  const results = await run(ctx, {
    resolver: resolvers.get(config.resolver),
    renderer: renderers.get(config.changelogRenderer),
  });

  // Write the files locally so the gateway can read them into the PR commit.
  const { applyResult } = await import("./writers.ts");
  for (const r of results) applyResult(repoRoot, r);

  // Resolve each project's extraFiles globs (e.g. "dist/**") to concrete
  // repo-relative paths, so built artifacts ride in the release PR commit.
  const { globSync, statSync } = await import("node:fs");
  const { join: pjoin } = await import("node:path");
  const extraFilesFor = (projectPath: string): string[] => {
    const proj = config.trackedProjects.find((p) => p.path === projectPath);
    const globs = proj?.extraFiles ?? [];
    const files = new Set<string>();
    for (const g of globs) {
      for (const f of globSync(g, { cwd: repoRoot })) {
        // Globs like "dist/**" also match directories; keep only regular files.
        if (statSync(pjoin(repoRoot, f)).isFile()) files.add(f);
      }
    }
    return [...files];
  };

  const baseBranch = github.context.ref.replace("refs/heads/", "");
  const touched = await handlePush(gateway, baseBranch, results, extraFilesFor);

  core.setOutput("hasChanges", String(touched.length > 0));
  core.setOutput("releasePRs", JSON.stringify(touched));
  for (const t of touched) core.info(`release PR #${t.prNumber} for ${t.tagPrefix}`);
}

main().catch((err: unknown) => core.setFailed((err as Error).message));
