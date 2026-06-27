import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveClosure, closureDirs } from "./closure.ts";
import type { WorkspaceGraph } from "./types.ts";

// Mirrors the verified edge-case fixture: games <-> util cycle, types -> unrelated (dev only).
const graph: WorkspaceGraph = {
  packages: [
    { name: "@lego/kc-bff", dir: "/apps/bff", internalDeps: ["@lego/types", "@lego/games"], internalDevDeps: [] },
    { name: "@lego/games", dir: "/packages/games", internalDeps: ["@lego/util"], internalDevDeps: [] },
    { name: "@lego/util", dir: "/packages/util", internalDeps: ["@lego/types", "@lego/games"], internalDevDeps: [] },
    { name: "@lego/types", dir: "/packages/types", internalDeps: [], internalDevDeps: ["@lego/unrelated"] },
    { name: "@lego/unrelated", dir: "/packages/unrelated", internalDeps: [], internalDevDeps: [] },
  ],
};

test("prod closure terminates on a cycle and is correct", () => {
  const closure = resolveClosure(graph, "@lego/kc-bff", { includeDev: false });
  assert.deepEqual(
    [...closure].sort(),
    ["@lego/games", "@lego/kc-bff", "@lego/types", "@lego/util"],
  );
});

test("prod closure excludes the dev-only package", () => {
  const closure = resolveClosure(graph, "@lego/kc-bff", { includeDev: false });
  assert.ok(!closure.has("@lego/unrelated"));
});

test("includeDev pulls in the dev-only package", () => {
  const closure = resolveClosure(graph, "@lego/kc-bff", { includeDev: true });
  assert.ok(closure.has("@lego/unrelated"));
});

test("unknown dep names are ignored, not fatal", () => {
  const closure = resolveClosure(graph, "@lego/does-not-exist", { includeDev: false });
  assert.deepEqual([...closure], ["@lego/does-not-exist"]);
});

test("closureDirs maps names to absolute dirs", () => {
  const closure = resolveClosure(graph, "@lego/games", { includeDev: false });
  assert.deepEqual(closureDirs(graph, closure).sort(), [
    "/packages/games",
    "/packages/types",
    "/packages/util",
  ]);
});
