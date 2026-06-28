// Bundle the action entrypoint to a single dist/index.js (committed; that's how
// JS GitHub Actions ship). Uses esbuild's JS API for reliable cross-env builds.
import { build } from "esbuild";

await build({
  entryPoints: ["src/action.ts"],
  bundle: true,
  platform: "node",
  target: "node24",
  // ESM to match package.json "type":"module" — a CJS bundle would hit
  // "require is not defined" at runtime (verified failure on real Actions).
  format: "esm",
  outfile: "dist/index.js",
  // Some bundled deps reference require/__dirname; shim them for ESM output.
  banner: {
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url); import { fileURLToPath as __ftu } from 'url'; import { dirname as __dn } from 'path'; const __filename = __ftu(import.meta.url); const __dirname = __dn(__filename);",
  },
});

console.log("built dist/index.js");
