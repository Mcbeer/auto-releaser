import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRelease } from "./release.ts";
import type { CommitInfo, ReleaseConfig, TrackedProject } from "./types.ts";
import type { ClosureEntry } from "./attribution.ts";

const project: TrackedProject = {
  path: "apps/backend-for-frontend",
  tagPrefix: "kc-bff",
};

const config = {
  commitTypes: { feat: "minor", fix: "patch", perf: "patch" },
} as unknown as ReleaseConfig;

// BFF bundles games + types; own folder included.
const closure: ClosureEntry[] = [
  { name: "@lego/kc-bff", relDir: "apps/backend-for-frontend" },
  { name: "@lego/games", relDir: "packages/games" },
  { name: "@lego/types", relDir: "packages/types" },
];

function commit(sha: string, message: string, ...paths: string[]): CommitInfo {
  return { sha, message, changedPaths: paths };
}

test("dep change bumps the BFF (the whole point of the tool)", () => {
  const r = computeRelease({
    project,
    currentVersion: "12.2.0",
    commits: [commit("a", "feat: add scoring", "packages/games/src/score.ts")],
    closure,
    config,
  });
  assert.equal(r?.bump, "minor");
  assert.equal(r?.nextVersion, "12.3.0");
  assert.equal(r?.commits[0]?.sourcePackage, "@lego/games");
});

test("max bump across attributed commits wins", () => {
  const r = computeRelease({
    project,
    currentVersion: "12.2.0",
    commits: [
      commit("a", "fix: x", "packages/games/a.ts"),
      commit("b", "feat!: breaking change", "packages/types/b.ts"),
      commit("c", "fix: y", "apps/backend-for-frontend/c.ts"),
    ],
    closure,
    config,
  });
  assert.equal(r?.bump, "major");
  assert.equal(r?.nextVersion, "13.0.0");
});

test("commits outside the closure are ignored", () => {
  const r = computeRelease({
    project,
    currentVersion: "12.2.0",
    commits: [commit("a", "feat: x", "packages/unrelated/a.ts")],
    closure,
    config,
  });
  assert.equal(r, null);
});

test("no-op safety: no attributed bumps -> null (no empty release)", () => {
  const r = computeRelease({
    project,
    currentVersion: "12.2.0",
    commits: [
      commit("a", "docs: readme", "packages/games/README.md"), // no-bump type
      commit("b", "feat: x", "packages/unrelated/x.ts"), // out of closure
    ],
    closure,
    config,
  });
  assert.equal(r, null);
});

test("commit scope (e.g. Jira ticket) is intentionally NOT used for grouping", () => {
  // feat(TEAMPP-193) touching packages/games => grouped under @lego/games (folder),
  // NOT under "TEAMPP-193". Scope is dropped; description has no ticket. This pins
  // the deliberate decision (see release.ts:40) so it isn't "fixed" by accident.
  const r = computeRelease({
    project,
    currentVersion: "12.2.0",
    commits: [commit("a", "feat(TEAMPP-193): add scoring", "packages/games/src/score.ts")],
    closure,
    config,
  });
  assert.equal(r?.commits[0]?.sourcePackage, "@lego/games");
  assert.equal(r?.commits[0]?.subject, "add scoring");
});

test("breaking via footer in body is detected through attribution", () => {
  const r = computeRelease({
    project,
    currentVersion: "12.2.0",
    commits: [
      commit(
        "a",
        "feat: new api\n\nBREAKING CHANGE: removed old endpoint",
        "packages/types/api.ts",
      ),
    ],
    closure,
    config,
  });
  assert.equal(r?.bump, "major");
});
