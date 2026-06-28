// Bundle the action entrypoint to a single dist/index.js (committed; that's how
// JS GitHub Actions ship). Uses esbuild's JS API for reliable cross-env builds.
import { build } from "esbuild";

await build({
  entryPoints: ["src/action.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "dist/index.js",
  // Octokit/undici bundle cleanly (verified); nothing to mark external.
});

console.log("built dist/index.js");
