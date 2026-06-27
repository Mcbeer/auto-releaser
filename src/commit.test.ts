import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommit, commitBump } from "./commit.ts";
import type { ReleaseConfig } from "./types.ts";

const config = {
  commitTypes: { feat: "minor", fix: "patch", perf: "patch", refactor: "patch", revert: "patch" },
} as unknown as ReleaseConfig;

test("parses type, scope, description", () => {
  const p = parseCommit("feat(api): add games endpoint");
  assert.equal(p.type, "feat");
  assert.equal(p.scope, "api");
  assert.equal(p.breaking, false);
  assert.equal(p.description, "add games endpoint");
});

test("type is lowercased (spec: case-insensitive except BREAKING CHANGE)", () => {
  assert.equal(parseCommit("FIX: typo").type, "fix");
});

test("breaking via ! in prefix", () => {
  const p = parseCommit("feat!: drop node 18");
  assert.equal(p.breaking, true);
});

test("breaking via ! with scope", () => {
  assert.equal(parseCommit("feat(api)!: drop node 18").breaking, true);
});

test("breaking via footer (uppercase BREAKING CHANGE)", () => {
  const p = parseCommit("feat: x\n\nBREAKING CHANGE: config format changed");
  assert.equal(p.breaking, true);
});

test("BREAKING-CHANGE hyphenated synonym is honored", () => {
  const p = parseCommit("feat: x\n\nBREAKING-CHANGE: config format changed");
  assert.equal(p.breaking, true);
});

test("lowercase 'breaking change:' footer does NOT count (spec: must be uppercase)", () => {
  const p = parseCommit("feat: x\n\nbreaking change: nope");
  assert.equal(p.breaking, false);
});

test("non-conforming subject is not fatal", () => {
  const p = parseCommit("merged main into branch");
  assert.equal(p.type, null);
  assert.equal(p.breaking, false);
});

test("commitBump: breaking always major regardless of type", () => {
  assert.equal(commitBump(parseCommit("fix!: x"), config), "major");
});

test("commitBump: feat->minor, fix->patch", () => {
  assert.equal(commitBump(parseCommit("feat: x"), config), "minor");
  assert.equal(commitBump(parseCommit("fix: x"), config), "patch");
});

test("commitBump: revert is config-driven (no spec default)", () => {
  assert.equal(commitBump(parseCommit("revert: x"), config), "patch");
});

test("commitBump: unknown/non-conforming type -> null (no bump)", () => {
  assert.equal(commitBump(parseCommit("docs: x"), config), null);
  assert.equal(commitBump(parseCommit("not a commit"), config), null);
});

test("Jira-ticket scopes parse and version correctly (hyphen + digits)", () => {
  const p = parseCommit("feat(TEAMPP-193): add scoring");
  assert.equal(p.type, "feat");
  assert.equal(p.scope, "TEAMPP-193");
  assert.equal(commitBump(p, config), "minor");
  // breaking variant with ticket scope
  assert.equal(commitBump(parseCommit("fix(ABC-1)!: x"), config), "major");
});
