import { test } from "node:test";
import assert from "node:assert/strict";
import { groupedByPackageRenderer } from "./grouped-by-package.ts";
import type { ComputedRelease, ReleaseContext, TrackedProject } from "../types.ts";

const project: TrackedProject = { path: "apps/bff", tagPrefix: "kc-bff" };
const ctx = {} as ReleaseContext; // renderer ignores ctx
const render = (r: ComputedRelease) => groupedByPackageRenderer.render(r, ctx);

test("groups subjects under their source package, packages sorted", () => {
  const out = render({
    project,
    nextVersion: "12.3.0",
    bump: "minor",
    commits: [
      { subject: "add scoring", bump: "minor", sourcePackage: "@lego/games" },
      { subject: "fix types", bump: "patch", sourcePackage: "@lego/types" },
      { subject: "add levels", bump: "minor", sourcePackage: "@lego/games" },
    ],
  });
  assert.equal(
    out,
    [
      "## 12.3.0",
      "",
      "### @lego/games",
      "",
      "- add scoring",
      "- add levels",
      "",
      "### @lego/types",
      "",
      "- fix types",
    ].join("\n") + "\n",
  );
});

test("single package, single commit", () => {
  const out = render({
    project,
    nextVersion: "12.2.1",
    bump: "patch",
    commits: [{ subject: "patch leak", bump: "patch", sourcePackage: "@lego/kc-bff" }],
  });
  assert.equal(out, "## 12.2.1\n\n### @lego/kc-bff\n\n- patch leak\n");
});

test("output ends with exactly one trailing newline", () => {
  const out = render({
    project,
    nextVersion: "1.0.0",
    bump: "major",
    commits: [{ subject: "x", bump: "major", sourcePackage: "p" }],
  });
  assert.ok(out.endsWith("\n") && !out.endsWith("\n\n"));
});
