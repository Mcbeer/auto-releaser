import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitReader } from "./git.ts";

let repo: string;
const run = (args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });

before(() => {
  repo = mkdtempSync(join(tmpdir(), "git-reader-test-"));
  run(["init", "-q"]);
  run(["config", "user.email", "t@t.co"]);
  run(["config", "user.name", "t"]);
  run(["config", "commit.gpgsign", "false"]);
  run(["config", "tag.gpgsign", "false"]);

  mkdirSync(join(repo, "apps/bff"), { recursive: true });
  mkdirSync(join(repo, "packages/games/src"), { recursive: true });
  writeFileSync(join(repo, "apps/bff/index.ts"), "a\n");
  writeFileSync(join(repo, "packages/games/src/score.ts"), "b\n");
  run(["add", "-A"]);
  run(["commit", "-q", "-m", "feat: initial bff"]);
  const first = run(["rev-list", "--max-parents=0", "HEAD"]).toString().trim();
  run(["tag", "kc-bff-v12.1.0", first]);
  run(["tag", "kc-bff-v12.2.0", first]);
  run(["tag", "other-v9.9.9", first]); // foreign prefix must not bleed

  appendFileSync(join(repo, "packages/games/src/score.ts"), "c\n");
  run(["add", "-A"]);
  // multi-line body with a BREAKING CHANGE footer + Jira scope
  run([
    "commit",
    "-q",
    "-m",
    "feat(TEAMPP-193): add scoring\n\nBody paragraph.\n\nBREAKING CHANGE: removed old endpoint",
  ]);

  appendFileSync(join(repo, "apps/bff/index.ts"), "d\n");
  run(["add", "-A"]);
  run(["commit", "-q", "-m", "fix: patch leak"]);
});

after(() => rmSync(repo, { recursive: true, force: true }));

test("lastTag returns highest version for prefix, ignoring foreign prefixes", async () => {
  const git = createGitReader(repo);
  assert.equal(await git.lastTag("kc-bff"), "kc-bff-v12.2.0");
});

test("lastTag returns null when no tag matches (first-run case)", async () => {
  const git = createGitReader(repo);
  assert.equal(await git.lastTag("nonexistent"), null);
});

test("log since tag returns commits with full message + changed paths", async () => {
  const git = createGitReader(repo);
  const commits = await git.log("kc-bff-v12.2.0");
  assert.equal(commits.length, 2);

  // newest first
  const [fix, feat] = commits;
  assert.equal(fix?.message, "fix: patch leak");
  assert.deepEqual(fix?.changedPaths, ["apps/bff/index.ts"]);

  // multi-line body preserved (BREAKING CHANGE footer must survive)
  assert.match(feat!.message, /^feat\(TEAMPP-193\): add scoring/);
  assert.match(feat!.message, /BREAKING CHANGE: removed old endpoint/);
  assert.deepEqual(feat?.changedPaths, ["packages/games/src/score.ts"]);
});

test("log with null sinceRef returns whole history (first run)", async () => {
  const git = createGitReader(repo);
  const commits = await git.log(null);
  assert.equal(commits.length, 3);
});

test("log over an empty range returns no commits (no-op safety)", async () => {
  const git = createGitReader(repo);
  const commits = await git.log("HEAD");
  assert.deepEqual(commits, []);
});

test("sha is captured and looks like a hash", async () => {
  const git = createGitReader(repo);
  const commits = await git.log("kc-bff-v12.2.0");
  for (const c of commits) assert.match(c.sha, /^[0-9a-f]{40}$/);
});
