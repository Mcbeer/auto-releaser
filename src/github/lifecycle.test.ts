import { test } from "node:test";
import assert from "node:assert/strict";
import {
  handlePush,
  handleReleasePrMerged,
  releaseBranch,
  isReleaseBranch,
  isReleaseCommit,
} from "./lifecycle.ts";
import type { GitHubGateway, PullRequestUpsert } from "./gateway.ts";
import type { ProjectResult } from "../orchestrate.ts";
import type { TrackedProject } from "../types.ts";

function fakeGateway() {
  const upserts: PullRequestUpsert[] = [];
  const tags = new Set<string>();
  const releases: { tag: string; sha: string }[] = [];
  const gw: GitHubGateway = {
    async upsertPullRequest(pr) {
      upserts.push(pr);
      return { number: upserts.length, url: `https://pr/${upserts.length}` };
    },
    async createTagAndRelease(tag, sha) {
      tags.add(tag);
      releases.push({ tag, sha });
    },
    async tagExists(tag) {
      return tags.has(tag);
    },
  };
  return { gw, upserts, tags, releases };
}

function result(tagPrefix: string, path: string, version: string | null, notes = ""): ProjectResult {
  return {
    tagPrefix,
    projectPath: path,
    release: version === null ? null : { project: { path, tagPrefix }, nextVersion: version, bump: "minor", commits: [] },
    notes,
  };
}

test("branch helpers", () => {
  assert.equal(releaseBranch("kc-bff"), "release/kc-bff");
  assert.ok(isReleaseBranch("release/kc-bff"));
  assert.ok(!isReleaseBranch("feature/x"));
});

test("isReleaseCommit guards our own release commits (prevents re-bump drift)", () => {
  assert.ok(isReleaseCommit("chore(release): bff 1.3.0"));
  assert.ok(isReleaseCommit("chore(release): bff 1.3.0 (#4)"));
  assert.ok(!isReleaseCommit("feat: a normal feature"));
  assert.ok(!isReleaseCommit("fix(games): bug"));
});

test("handlePush upserts one PR per changed project, scoped to its files", async () => {
  const { gw, upserts } = fakeGateway();
  const touched = await handlePush(gw, "main", [
    result("bff", "apps/bff", "1.1.0", "## 1.1.0\n- x"),
    result("admin", "apps/admin", "2.1.0", "## 2.1.0\n- y"),
    result("idle", "apps/idle", null),
  ]);
  assert.equal(touched.length, 2);
  assert.equal(upserts[0]?.headBranch, "release/bff");
  assert.deepEqual(upserts[0]?.files, ["apps/bff/package.json", "apps/bff/CHANGELOG.md"]);
  assert.equal(upserts[0]?.body, "## 1.1.0\n- x");
  assert.equal(upserts[1]?.headBranch, "release/admin");
});

test("handlePush includes extraFiles; root project '.' yields clean paths (no ./)", async () => {
  const { gw, upserts } = fakeGateway();
  await handlePush(
    gw,
    "main",
    [result("tool", ".", "1.1.0", "## 1.1.0")],
    (p) => (p === "." ? ["dist/index.js"] : []),
  );
  // root project must NOT produce "./package.json" (Git tree API rejects it)
  assert.deepEqual(upserts[0]?.files, ["package.json", "CHANGELOG.md", "dist/index.js"]);
});

test("handlePush uses nested paths for non-root projects", async () => {
  const { gw, upserts } = fakeGateway();
  await handlePush(gw, "main", [result("bff", "apps/bff", "1.1.0", "x")]);
  assert.deepEqual(upserts[0]?.files, ["apps/bff/package.json", "apps/bff/CHANGELOG.md"]);
});

test("handlePush opens nothing when no project changed", async () => {
  const { gw, upserts } = fakeGateway();
  const touched = await handlePush(gw, "main", [result("bff", "apps/bff", null)]);
  assert.equal(touched.length, 0);
  assert.equal(upserts.length, 0);
});

const projects: TrackedProject[] = [
  { path: "apps/bff", tagPrefix: "bff" },
  { path: "apps/admin", tagPrefix: "admin" },
];

test("handleReleasePrMerged creates the right tag from the branch + version", async () => {
  const { gw, tags } = fakeGateway();
  const out = await handleReleasePrMerged(
    gw,
    { headRef: "release/bff", mergeSha: "abc123" },
    projects,
    () => "1.1.0",
  );
  assert.deepEqual(out, { tag: "bff-v1.1.0", created: true });
  assert.ok(tags.has("bff-v1.1.0"));
});

test("handleReleasePrMerged is idempotent if tag already exists", async () => {
  const { gw } = fakeGateway();
  await gw.createTagAndRelease("bff-v1.1.0", "old", "x");
  const out = await handleReleasePrMerged(
    gw,
    { headRef: "release/bff", mergeSha: "new" },
    projects,
    () => "1.1.0",
  );
  assert.deepEqual(out, { tag: "bff-v1.1.0", created: false });
});

test("handleReleasePrMerged ignores non-release branches", async () => {
  const { gw } = fakeGateway();
  const out = await handleReleasePrMerged(gw, { headRef: "feature/x", mergeSha: "s" }, projects, () => "1.0.0");
  assert.equal(out, null);
});

test("handleReleasePrMerged throws on unknown release prefix", async () => {
  const { gw } = fakeGateway();
  await assert.rejects(
    handleReleasePrMerged(gw, { headRef: "release/unknown", mergeSha: "s" }, projects, () => "1.0.0"),
    /no matching tracked project/,
  );
});