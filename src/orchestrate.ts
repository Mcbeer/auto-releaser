// Orchestration: run the verified pipeline for every tracked project.
// IO is confined to ctx.git + the resolver; this function returns plain data so
// the CLI shell owns file-writing and stdout. Mirrors the proven smoke-test wiring.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ChangelogRenderer,
  ComputedRelease,
  ReleaseContext,
  WorkspaceGraph,
  WorkspaceGraphProvider,
} from "./types.ts";
import { resolveClosure } from "./closure.ts";
import { toClosureEntries } from "./attribution.ts";
import { computeRelease } from "./release.ts";

export interface ProjectResult {
  readonly tagPrefix: string;
  readonly projectPath: string;
  readonly release: ComputedRelease | null; // null = no changes
  readonly notes: string; // "" when no release
}

export interface Deps {
  readonly resolver: WorkspaceGraphProvider;
  readonly renderer: ChangelogRenderer;
}

export async function run(ctx: ReleaseContext, deps: Deps): Promise<ProjectResult[]> {
  const graph = await deps.resolver.readWorkspaceGraph(ctx);
  const results: ProjectResult[] = [];

  for (const project of ctx.config.trackedProjects) {
    const pkg = findPackageByPath(graph, ctx.repoRoot, project.path);
    if (pkg === null) {
      throw new Error(
        `Tracked project "${project.path}" is not a workspace package (resolver found no package there).`,
      );
    }

    const closure = resolveClosure(graph, pkg.name, { includeDev: ctx.config.includeDev });
    const entries = toClosureEntries(
      ctx.repoRoot,
      graph.packages.filter((p) => closure.has(p.name)),
    );

    const lastTag = await ctx.git.lastTag(project.tagPrefix);
    const commits = await ctx.git.log(lastTag);
    const currentVersion = readVersion(ctx.repoRoot, project.path);

    const release = computeRelease({
      project,
      currentVersion,
      commits,
      closure: entries,
      config: ctx.config,
    });

    if (release === null) {
      ctx.logger.info(`${project.tagPrefix}: no changes`);
      results.push({ tagPrefix: project.tagPrefix, projectPath: project.path, release: null, notes: "" });
    } else {
      ctx.logger.info(
        `${project.tagPrefix}: ${release.bump} -> ${release.nextVersion} (${release.commits.length} commits)`,
      );
      results.push({
        tagPrefix: project.tagPrefix,
        projectPath: project.path,
        release,
        notes: deps.renderer.render(release, ctx),
      });
    }
  }

  return results;
}

function findPackageByPath(graph: WorkspaceGraph, repoRoot: string, relPath: string) {
  const want = join(repoRoot, relPath);
  return (
    graph.packages.find((p) => p.dir === want || p.dir.endsWith("/" + relPath)) ?? null
  );
}

function readVersion(repoRoot: string, projectPath: string): string {
  const pkgPath = join(repoRoot, projectPath, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
  if (typeof pkg.version !== "string") {
    throw new Error(`${pkgPath} has no "version" field.`);
  }
  return pkg.version;
}
