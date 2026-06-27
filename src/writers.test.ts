import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeVersion, writeChangelog } from "./writers.ts";

function fixture(pkgJson: string) {
  const root = mkdtempSync(join(tmpdir(), "writers-"));
  mkdirSync(join(root, "apps/bff"), { recursive: true });
  writeFileSync(join(root, "apps/bff/package.json"), pkgJson);
  return root;
}

test("writeVersion updates only the version, preserving formatting", () => {
  const root = fixture('{\n  "name": "@lego/kc-bff",\n  "version": "12.2.0",\n  "private": true\n}\n');
  try {
    writeVersion(root, "apps/bff", "12.3.0");
    const after = readFileSync(join(root, "apps/bff/package.json"), "utf8");
    assert.equal(
      after,
      '{\n  "name": "@lego/kc-bff",\n  "version": "12.3.0",\n  "private": true\n}\n',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("writeVersion throws if no version field", () => {
  const root = fixture('{ "name": "x" }');
  try {
    assert.throws(() => writeVersion(root, "apps/bff", "1.0.0"), /version/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("writeChangelog creates the file with header when absent", () => {
  const root = fixture("{}");
  try {
    writeChangelog(root, "apps/bff", "## 12.3.0\n\n### @lego/games\n\n- add scoring");
    const cl = readFileSync(join(root, "apps/bff/CHANGELOG.md"), "utf8");
    assert.match(cl, /^# Changelog\n\n## 12\.3\.0/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("writeChangelog prepends newest above older entries", () => {
  const root = fixture("{}");
  try {
    writeChangelog(root, "apps/bff", "## 12.3.0\n\n- first release");
    writeChangelog(root, "apps/bff", "## 12.4.0\n\n- second release");
    const cl = readFileSync(join(root, "apps/bff/CHANGELOG.md"), "utf8");
    assert.ok(cl.indexOf("12.4.0") < cl.indexOf("12.3.0"), "newest first");
    assert.equal(cl.match(/# Changelog/g)?.length, 1, "single header");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
