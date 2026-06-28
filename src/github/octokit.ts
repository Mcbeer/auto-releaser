// Concrete GitHubGateway backed by Octokit + the Git Data API. This is the ONLY
// file that talks to GitHub. Reimplements what create-pull-request did:
// commit specific files onto a release branch (idempotent) + open/update the PR.
//
// Sequence (verified against the GitHub REST Git Data API):
//   1. read base branch head commit + its tree
//   2. create a tree from base_tree with inline file contents (no separate blob step)
//   3. create a commit with that tree, parented on the base head
//   4. create or force-update refs/heads/<headBranch> to that commit
//   5. create the PR if absent (else it already tracks the branch we just updated)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GitHubGateway, PullRequestUpsert } from "./gateway.ts";

// Minimal shape of the Octokit REST client we use (keeps this file honest about
// exactly which endpoints we depend on).
export interface OctokitLike {
  rest: {
    repos: {
      getBranch(p: { owner: string; repo: string; branch: string }): Promise<{ data: { commit: { sha: string; commit: { tree: { sha: string } } } } }>;
      createRelease(p: { owner: string; repo: string; tag_name: string; name: string; body: string }): Promise<unknown>;
    };
    git: {
      createTree(p: { owner: string; repo: string; base_tree: string; tree: { path: string; mode: "100644"; type: "blob"; content: string }[] }): Promise<{ data: { sha: string } }>;
      createCommit(p: { owner: string; repo: string; message: string; tree: string; parents: string[] }): Promise<{ data: { sha: string } }>;
      createRef(p: { owner: string; repo: string; ref: string; sha: string }): Promise<unknown>;
      updateRef(p: { owner: string; repo: string; ref: string; sha: string; force: boolean }): Promise<unknown>;
      getRef(p: { owner: string; repo: string; ref: string }): Promise<{ data: { object: { sha: string } } }>;
      createTag?(p: unknown): Promise<unknown>;
    };
    pulls: {
      list(p: { owner: string; repo: string; head: string; state: "open" }): Promise<{ data: { number: number; html_url: string }[] }>;
      create(p: { owner: string; repo: string; head: string; base: string; title: string; body: string }): Promise<{ data: { number: number; html_url: string } }>;
      update(p: { owner: string; repo: string; pull_number: number; title: string; body: string }): Promise<unknown>;
    };
    issues: {
      addLabels(p: { owner: string; repo: string; issue_number: number; labels: string[] }): Promise<unknown>;
    };
  };
}

export interface RepoRef {
  readonly owner: string;
  readonly repo: string;
  readonly repoRoot: string; // local checkout, to read file contents
}

export function createOctokitGateway(octokit: OctokitLike, ref: RepoRef): GitHubGateway {
  const { owner, repo, repoRoot } = ref;

  async function refExists(fullRef: string): Promise<string | null> {
    try {
      const r = await octokit.rest.git.getRef({ owner, repo, ref: fullRef });
      return r.data.object.sha;
    } catch {
      return null;
    }
  }

  return {
    async upsertPullRequest(pr: PullRequestUpsert) {
      // 1. base head + tree
      const base = await octokit.rest.repos.getBranch({ owner, repo, branch: pr.baseBranch });
      const baseSha = base.data.commit.sha;
      const baseTree = base.data.commit.commit.tree.sha;

      // 2. tree with inline file contents (GitHub writes blobs for us)
      const tree = pr.files.map((path) => ({
        path,
        mode: "100644" as const,
        type: "blob" as const,
        content: readFileSync(join(repoRoot, path), "utf8"),
      }));
      const newTree = await octokit.rest.git.createTree({ owner, repo, base_tree: baseTree, tree });

      // 3. commit
      const commit = await octokit.rest.git.createCommit({
        owner,
        repo,
        message: pr.commitMessage,
        tree: newTree.data.sha,
        parents: [baseSha],
      });

      // 4. create or force-update the release branch
      const headRef = `heads/${pr.headBranch}`;
      const existing = await refExists(headRef);
      if (existing === null) {
        await octokit.rest.git.createRef({ owner, repo, ref: `refs/heads/${pr.headBranch}`, sha: commit.data.sha });
      } else {
        await octokit.rest.git.updateRef({ owner, repo, ref: headRef, sha: commit.data.sha, force: true });
      }

      // 5. open the PR if none exists for this head; else update title/body
      const open = await octokit.rest.pulls.list({ owner, repo, head: `${owner}:${pr.headBranch}`, state: "open" });
      if (open.data.length === 0) {
        const created = await octokit.rest.pulls.create({
          owner, repo, head: pr.headBranch, base: pr.baseBranch, title: pr.title, body: pr.body,
        });
        if (pr.labels.length > 0) {
          await octokit.rest.issues.addLabels({ owner, repo, issue_number: created.data.number, labels: [...pr.labels] });
        }
        return { number: created.data.number, url: created.data.html_url };
      }
      const pull = open.data[0]!;
      await octokit.rest.pulls.update({ owner, repo, pull_number: pull.number, title: pr.title, body: pr.body });
      return { number: pull.number, url: pull.html_url };
    },

    async tagExists(tag: string) {
      return (await refExists(`tags/${tag}`)) !== null;
    },

    async createTagAndRelease(tag: string, sha: string, notes: string) {
      // Lightweight tag ref pointing at the merge commit, then a release.
      await octokit.rest.git.createRef({ owner, repo, ref: `refs/tags/${tag}`, sha });
      await octokit.rest.repos.createRelease({ owner, repo, tag_name: tag, name: tag, body: notes });
    },
  };
}
