import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attributeCommit, toClosureEntries, type ClosureEntry } from "./attribution.ts";

const closure: ClosureEntry[] = [
  { name: "@lego/kc-bff", relDir: "apps/backend-for-frontend" },
  { name: "@lego/games", relDir: "packages/games" },
  { name: "@lego/types", relDir: "packages/types" },
];

test("file inside a dep folder attributes to that package", () => {
  const s = attributeCommit(["packages/games/src/index.ts"], closure);
  assert.deepEqual([...s], ["@lego/games"]);
});

test("file inside the project's own folder attributes to the project", () => {
  const s = attributeCommit(["apps/backend-for-frontend/build.js"], closure);
  assert.deepEqual([...s], ["@lego/kc-bff"]);
});

test("file outside the closure attributes to nothing", () => {
  const s = attributeCommit(["packages/unrelated/x.ts"], closure);
  assert.equal(s.size, 0);
});

test("a single commit can touch multiple closure packages", () => {
  const s = attributeCommit(
    ["packages/games/a.ts", "packages/types/b.ts"],
    closure,
  );
  assert.deepEqual([...s].sort(), ["@lego/games", "@lego/types"]);
});

test("deepest folder wins when packages nest", () => {
  const nested: ClosureEntry[] = [
    { name: "@lego/parent", relDir: "packages/parent" },
    { name: "@lego/child", relDir: "packages/parent/packages/child" },
  ];
  const s = attributeCommit(["packages/parent/packages/child/x.ts"], nested);
  assert.deepEqual([...s], ["@lego/child"]);
});

test("prefix collisions don't false-match (games vs games-extra)", () => {
  const c: ClosureEntry[] = [
    { name: "@lego/games", relDir: "packages/games" },
    { name: "@lego/games-extra", relDir: "packages/games-extra" },
  ];
  const s = attributeCommit(["packages/games-extra/x.ts"], c);
  assert.deepEqual([...s], ["@lego/games-extra"]);
});

test("repo-root closure entry (\".\" or \"\") contains everything", () => {
  const c: ClosureEntry[] = [{ name: "root", relDir: "." }];
  assert.deepEqual([...attributeCommit(["any/path/x.ts"], c)], ["root"]);
  const c2: ClosureEntry[] = [{ name: "root", relDir: "" }];
  assert.deepEqual([...attributeCommit(["any/path/x.ts"], c2)], ["root"]);
});

test("exact file-path match attributes (path === dir edge)", () => {
  const c: ClosureEntry[] = [{ name: "f", relDir: "packages/types/index.ts" }];
  assert.deepEqual([...attributeCommit(["packages/types/index.ts"], c)], ["f"]);
});

test("toClosureEntries converts absolute dirs to repo-relative posix", () => {
  const entries = toClosureEntries("/repo", [
    { name: "@lego/games", dir: "/repo/packages/games" },
  ]);
  assert.deepEqual(entries, [{ name: "@lego/games", relDir: "packages/games" }]);
});

test("toClosureEntries normalizes symlinked roots (realpath) — regression", () => {
  // Real repo dirs under a symlinked root (e.g. macOS /var -> /private/var, or
  // $GITHUB_WORKSPACE). repoRoot given in unresolved form, pkg dir in resolved
  // form. Without realpath this produced a broken ../../.. relDir that matched
  // nothing — silently breaking attribution. Caught only by the e2e smoke test.
  const tmp = mkdtempSync(join(tmpdir(), "attr-realpath-"));
  try {
    mkdirSync(join(tmp, "packages/games"), { recursive: true });
    const real = realpathSync(tmp);
    // Pass the *resolved* pkg dir but the *unresolved* root (the mismatch case).
    const entries = toClosureEntries(tmp, [
      { name: "@lego/games", dir: join(real, "packages/games") },
    ]);
    assert.deepEqual(entries, [{ name: "@lego/games", relDir: "packages/games" }]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
