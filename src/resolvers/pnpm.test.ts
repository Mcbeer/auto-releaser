import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { pnpmResolver } from "./pnpm.ts";
import { resolveClosure } from "../closure.ts";
import type { ReleaseContext } from "../types.ts";

// Integration test against the verified edge-case fixture (catalogs, ws protocol
// variants, games<->util cycle). Skips if the fixture isn't present.
const FIXTURE = "/var/folders/9c/jpb3hbbd3wn_mt2zkn1438tc0000gn/T/opencode/ws-edge";

const ctx = { repoRoot: FIXTURE } as ReleaseContext;

test(
  "pnpm adapter reports the internal graph; externals + catalogs excluded",
  { skip: !existsSync(`${FIXTURE}/pnpm-workspace.yaml`) ? "fixture absent" : false },
  async () => {
    const graph = await pnpmResolver.readWorkspaceGraph(ctx);
    const names = graph.packages.map((p) => p.name).sort();
    assert.deepEqual(names, [
      "@lego/games",
      "@lego/kc-bff",
      "@lego/types",
      "@lego/unrelated",
      "@lego/util",
    ]);
    // no externals/catalogs leaked as packages
    assert.ok(!names.includes("left-pad") && !names.includes("react"));
  },
);

test(
  "full pipeline: adapter graph + shared closure = correct prod closure",
  { skip: !existsSync(`${FIXTURE}/pnpm-workspace.yaml`) ? "fixture absent" : false },
  async () => {
    const graph = await pnpmResolver.readWorkspaceGraph(ctx);
    const closure = resolveClosure(graph, "@lego/kc-bff", { includeDev: false });
    assert.deepEqual(
      [...closure].sort(),
      ["@lego/games", "@lego/kc-bff", "@lego/types", "@lego/util"],
    );
  },
);
