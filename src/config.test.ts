import { test } from "node:test";
import assert from "node:assert/strict";
import { validateConfig, loadConfig, pathForTagPrefix, ConfigError } from "./config.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const minimal = { trackedProjects: [{ path: "apps/bff", tagPrefix: "kc-bff" }] };

test("minimal config applies sensible defaults", () => {
  const c = validateConfig(minimal);
  assert.equal(c.resolver, "pnpm");
  assert.equal(c.changelogRenderer, "grouped-by-package");
  assert.equal(c.includeDev, false);
  assert.equal(c.commitTypes["feat"], "minor");
  assert.equal(c.trackedProjects.length, 1);
});

test("explicit values override defaults", () => {
  const c = validateConfig({
    ...minimal,
    resolver: "yarn",
    includeDev: true,
    commitTypes: { feat: "major" },
  });
  assert.equal(c.resolver, "yarn");
  assert.equal(c.includeDev, true);
  assert.equal(c.commitTypes["feat"], "major");
});

test("rejects non-object config", () => {
  assert.throws(() => validateConfig([]), ConfigError);
  assert.throws(() => validateConfig(null), ConfigError);
  assert.throws(() => validateConfig("nope"), ConfigError);
});

test("rejects missing or empty trackedProjects", () => {
  assert.throws(() => validateConfig({}), /trackedProjects/);
  assert.throws(() => validateConfig({ trackedProjects: [] }), /non-empty/);
});

test("rejects trackedProject missing path or tagPrefix", () => {
  assert.throws(() => validateConfig({ trackedProjects: [{ path: "x" }] }), /tagPrefix/);
  assert.throws(() => validateConfig({ trackedProjects: [{ tagPrefix: "x" }] }), /path/);
});

test("rejects duplicate tagPrefix (tags would collide)", () => {
  assert.throws(
    () =>
      validateConfig({
        trackedProjects: [
          { path: "a", tagPrefix: "dup" },
          { path: "b", tagPrefix: "dup" },
        ],
      }),
    /Duplicate tagPrefix/,
  );
});

test("accepts and preserves extraFiles", () => {
  const c = validateConfig({
    trackedProjects: [{ path: ".", tagPrefix: "tool", extraFiles: ["dist/**", "action.yml"] }],
  });
  assert.deepEqual(c.trackedProjects[0]?.extraFiles, ["dist/**", "action.yml"]);
});

test("rejects malformed extraFiles", () => {
  assert.throws(
    () => validateConfig({ trackedProjects: [{ path: ".", tagPrefix: "t", extraFiles: "dist/**" }] }),
    /extraFiles must be an array/,
  );
  assert.throws(
    () => validateConfig({ trackedProjects: [{ path: ".", tagPrefix: "t", extraFiles: [""] }] }),
    /extraFiles must be an array/,
  );
});

test("rejects duplicate path (projects would overwrite each other)", () => {
  assert.throws(
    () =>
      validateConfig({
        trackedProjects: [
          { path: "apps/bff", tagPrefix: "a" },
          { path: "apps/bff", tagPrefix: "b" },
        ],
      }),
    /Duplicate path/,
  );
});

test("rejects invalid bump value in commitTypes", () => {
  assert.throws(
    () => validateConfig({ ...minimal, commitTypes: { feat: "huge" } }),
    /major\|minor\|patch/,
  );
});

test("rejects non-boolean includeDev", () => {
  assert.throws(() => validateConfig({ ...minimal, includeDev: "yes" }), /boolean/);
});

test("rejects empty-string resolver", () => {
  assert.throws(() => validateConfig({ ...minimal, resolver: "  " }), /non-empty/);
});

test("loadConfig reads and validates a real file", () => {
  const dir = mkdtempSync(join(tmpdir(), "config-test-"));
  try {
    const p = join(dir, "release.json");
    writeFileSync(p, JSON.stringify(minimal));
    const c = loadConfig(p);
    assert.equal(c.trackedProjects[0]?.tagPrefix, "kc-bff");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pathForTagPrefix returns the configured path (no hardcoding)", () => {
  const c = validateConfig({
    trackedProjects: [
      { path: "apps/backend-for-frontend", tagPrefix: "kc-bff" },
      { path: "apps/admin", tagPrefix: "kc-admin" },
    ],
  });
  assert.equal(pathForTagPrefix(c, "kc-bff"), "apps/backend-for-frontend");
  assert.equal(pathForTagPrefix(c, "kc-admin"), "apps/admin");
});

test("pathForTagPrefix throws with known prefixes on unknown input", () => {
  const c = validateConfig(minimal);
  assert.throws(() => pathForTagPrefix(c, "nope"), /No tracked project.*kc-bff/s);
});

test("loadConfig fails loud on missing file and bad JSON", () => {
  assert.throws(() => loadConfig("/no/such/file.json"), /Cannot read/);
  const dir = mkdtempSync(join(tmpdir(), "config-test-"));
  try {
    const p = join(dir, "bad.json");
    writeFileSync(p, "{ not json");
    assert.throws(() => loadConfig(p), /not valid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
