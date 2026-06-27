import { test } from "node:test";
import assert from "node:assert/strict";
import { Registry } from "./registry.ts";
import { resolvers, renderers } from "./builtins.ts";

test("get returns a registered impl", () => {
  const r = new Registry<{ name: string }>();
  const impl = { name: "x" };
  r.register(impl);
  assert.equal(r.get("x"), impl);
});

test("get throws with the list of known names when missing", () => {
  const r = new Registry<{ name: string }>();
  r.register({ name: "pnpm" });
  assert.throws(() => r.get("yarn"), /Unknown "yarn".*pnpm/s);
});

test("builtins: pnpm resolver and grouped-by-package renderer are registered", () => {
  assert.equal(resolvers.get("pnpm").name, "pnpm");
  assert.equal(renderers.get("grouped-by-package").name, "grouped-by-package");
});
