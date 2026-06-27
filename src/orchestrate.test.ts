import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./orchestrate.ts";
import { groupedByPackageRenderer } from "./renderers/grouped-by-package.ts";
import type {
  CommitInfo,
  GitReader,
  ReleaseConfig,
  ReleaseContext,
  WorkspaceGraphProvider,
} from "./types.ts";

// Fake git + resolver so orchestration is tested without real subprocesses.
function makeCtx(repoRoot: string, commits: CommitInfo[], lastTag: string | null): ReleaseContext {
  const config: ReleaseConfig = {
    resolver: "fake",
    changelogRenderer: "grouped-by-package",
    trackedProjects: [{ path: "apps/bff", tagPrefix: "kc-bff" }],
    commitTypes: { feat: "minor", fix: "patch" },
    includeDev: false,
  };
  const git: GitReader = {
    log: async () => commits,
    lastTag: async () => lastTag,
  };
  return { repoRoot, config, logger: { info() {}, warn() {} }, git };
}

function fakeResolver(repoRoot: string): WorkspaceGraphProvider {
  return {
    name: "fake",
    readWorkspaceGraph: async () => ({
      packages: [
        { name: "@lego/kc-bff", dir: join(repoRoot, "apps/bff"), internalDeps: ["@lego/games"], internalDevDeps: [] },
        { name: "@lego/games", dir: join(repoRoot, "packages/games"), internalDeps: [], internalDevDeps: [] },
      ],
    }),
  };
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "orch-"));
  mkdirSync(join(root, "apps/bff"), { recursive: true });
  // packages/games must exist on disk too: toClosureEntries realpath-resolves
  // package dirs, so both repoRoot and every package dir need to be real for the
  // relative paths to line up (the symlinked-/tmp lesson from the e2e smoke test).
  mkdirSync(join(root, "packages/games"), { recursive: true });
  writeFileSync(join(root, "apps/bff/package.json"), JSON.stringify({ name: "@lego/kc-bff", version: "12.2.0" }));
  return root;
}

test("dep change produces a release with notes", async () => {
  const root = fixture();
  try {
    const ctx = makeCtx(
      root,
      [{ sha: "a".repeat(40), message: "feat: add scoring", changedPaths: ["packages/games/x.ts"] }],
      "kc-bff-v12.2.0",
    );
    const [r] = await run(ctx, { resolver: fakeResolver(root), renderer: groupedByPackageRenderer });
    assert.equal(r?.release?.nextVersion, "12.3.0");
    assert.match(r!.notes, /@lego\/games/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("no relevant commits => null release, empty notes", async () => {
  const root = fixture();
  try {
    const ctx = makeCtx(
      root,
      [{ sha: "b".repeat(40), message: "docs: readme", changedPaths: ["packages/games/README.md"] }],
      "kc-bff-v12.2.0",
    );
    const [r] = await run(ctx, { resolver: fakeResolver(root), renderer: groupedByPackageRenderer });
    assert.equal(r?.release, null);
    assert.equal(r?.notes, "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("throws if a tracked project is not a workspace package", async () => {
  const root = fixture();
  try {
    const ctx = makeCtx(root, [], null);
    const emptyResolver: WorkspaceGraphProvider = {
      name: "fake",
      readWorkspaceGraph: async () => ({ packages: [] }),
    };
    await assert.rejects(
      run(ctx, { resolver: emptyResolver, renderer: groupedByPackageRenderer }),
      /not a workspace package/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
