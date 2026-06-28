import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOutputs } from "./outputs.ts";
import type { ProjectResult } from "./orchestrate.ts";
import type { ComputedRelease } from "./types.ts";

function result(tagPrefix: string, path: string, version: string | null, notes: string): ProjectResult {
  const release: ComputedRelease | null =
    version === null
      ? null
      : { project: { path, tagPrefix }, nextVersion: version, bump: "minor", commits: [] };
  return { tagPrefix, projectPath: path, release, notes: version === null ? "" : notes };
}

function parseLines(out: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of out.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0 && !line.includes("<<")) m.set(line.slice(0, eq), line.slice(eq + 1));
  }
  return m;
}

test("no changes => hasChanges=false, empty changedProjects array", () => {
  const out = buildOutputs([result("bff", "apps/bff", null, "")]);
  const kv = parseLines(out);
  assert.equal(kv.get("hasChanges"), "false");
  assert.equal(kv.get("changedProjects"), "[]");
});

test("changedProjects carries tagPrefix/path/version/notes for each changed project", () => {
  const out = buildOutputs([
    result("bff", "apps/bff", "1.2.0", "## 1.2.0\n\n### @s/games\n\n- a change"),
    result("admin", "apps/admin", "3.1.0", "## 3.1.0\n\n### @s/admin\n\n- other"),
  ]);
  const kv = parseLines(out);
  assert.equal(kv.get("hasChanges"), "true");

  const projects = JSON.parse(kv.get("changedProjects")!);
  assert.equal(projects.length, 2);
  assert.deepEqual(projects[0], {
    tagPrefix: "bff",
    path: "apps/bff",
    version: "1.2.0",
    notes: "## 1.2.0\n\n### @s/games\n\n- a change",
  });
});

test("CRITICAL: multiline notes survive single-line GITHUB_OUTPUT + fromJSON round-trip", () => {
  const notes = "## 1.2.0\n\n### @s/games\n\n- one\n- two\n- three";
  const out = buildOutputs([result("bff", "apps/bff", "1.2.0", notes)]);

  // The changedProjects line must be ONE line (no raw newline) or GITHUB_OUTPUT breaks.
  const cpLine = out.split("\n").find((l) => l.startsWith("changedProjects="))!;
  assert.ok(cpLine.endsWith("]"), "changedProjects must be a single self-contained line");

  // And fromJSON (what the workflow matrix does) must recover the exact multiline notes.
  const recovered = JSON.parse(cpLine.slice("changedProjects=".length))[0].notes;
  assert.equal(recovered, notes);
  assert.ok(recovered.includes("\n"), "newlines preserved through the round-trip");
});

test("changed projects excluded when release is null", () => {
  const out = buildOutputs([
    result("bff", "apps/bff", "1.2.0", "## 1.2.0\n- x"),
    result("admin", "apps/admin", null, ""),
  ]);
  const projects = JSON.parse(parseLines(out).get("changedProjects")!);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].tagPrefix, "bff");
});
