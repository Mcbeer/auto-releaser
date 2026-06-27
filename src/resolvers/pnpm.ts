import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  ReleaseContext,
  WorkspaceGraph,
  WorkspaceGraphProvider,
  WorkspacePackage,
} from "../types.ts";

const execFileAsync = promisify(execFile);

// Shape of `pnpm -r list --depth 0 --only-projects --json` entries.
// Verified empirically: --only-projects excludes externals AND catalog: deps
// (default + named); dependencies/devDependencies are direct only.
interface PnpmListEntry {
  name: string;
  path: string;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
}

export const pnpmResolver: WorkspaceGraphProvider = {
  name: "pnpm",

  async readWorkspaceGraph(ctx: ReleaseContext): Promise<WorkspaceGraph> {
    const { stdout } = await execFileAsync(
      "pnpm",
      ["-r", "list", "--depth", "0", "--only-projects", "--json"],
      { cwd: ctx.repoRoot, maxBuffer: 64 * 1024 * 1024 },
    );

    const entries = JSON.parse(stdout) as PnpmListEntry[];
    const internalNames = new Set(entries.map((e) => e.name));

    const packages: WorkspacePackage[] = entries.map((e) => ({
      name: e.name,
      dir: e.path,
      // Defensive intersection with internal names: --only-projects already
      // filters externals, but this guarantees the contract regardless.
      internalDeps: Object.keys(e.dependencies ?? {}).filter((n) => internalNames.has(n)),
      internalDevDeps: Object.keys(e.devDependencies ?? {}).filter((n) =>
        internalNames.has(n),
      ),
    }));

    return { packages };
  },
};
