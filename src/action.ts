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
    if (out === null) core.info("Merged PR is not a release branch; ignoring.");
    else core.info(`${out.created ? "Created" : "Already exists"}: ${out.tag}`);
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

  const baseBranch = github.context.ref.replace("refs/heads/", "");
  const touched = await handlePush(gateway, baseBranch, results);

  core.setOutput("hasChanges", String(touched.length > 0));
  core.setOutput("releasePRs", JSON.stringify(touched));
  for (const t of touched) core.info(`release PR #${t.prNumber} for ${t.tagPrefix}`);
}

main().catch((err: unknown) => core.setFailed((err as Error).message));
