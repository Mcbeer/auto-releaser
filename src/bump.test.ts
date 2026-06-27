import { test } from "node:test";
import assert from "node:assert/strict";
import { maxBump, applyBump } from "./bump.ts";

test("maxBump picks the highest", () => {
  assert.equal(maxBump(["patch", "minor", "patch"]), "minor");
  assert.equal(maxBump(["patch", "major", "minor"]), "major");
  assert.equal(maxBump(["patch", "patch"]), "patch");
});

test("maxBump ignores nulls; all-null -> null", () => {
  assert.equal(maxBump([null, "patch", null]), "patch");
  assert.equal(maxBump([null, null]), null);
  assert.equal(maxBump([]), null);
});

test("applyBump increments correctly and zeroes lower parts", () => {
  assert.equal(applyBump("12.2.0", "major"), "13.0.0");
  assert.equal(applyBump("12.2.3", "minor"), "12.3.0");
  assert.equal(applyBump("12.2.3", "patch"), "12.2.4");
});

test("applyBump rejects non-plain-semver", () => {
  assert.throws(() => applyBump("12.2.0-beta.1", "patch"));
  assert.throws(() => applyBump("v12.2.0", "patch"));
});
