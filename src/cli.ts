#!/usr/bin/env node
// CLI shell: parse args, build the real ReleaseContext, run orchestration, write
// files, emit hasChanges/version/notes to stdout + $GITHUB_OUTPUT. All logic
// lives in orchestrate.ts; this file is glue only.

import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, pathForTagPrefix } from "./config.ts";
import { createGitReader } from "./git.ts";
import { resolvers, renderers } from "./builtins.ts";
import { run, type ProjectResult } from "./orchestrate.ts";
import { applyResult } from "./writers.ts";
import type { Logger, ReleaseContext } from "./types.ts";

interface Args {
  config: string;
  repoRoot: string;
  dryRun: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { config: "release.json", repoRoot: process.cwd(), dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config") args.config = argv[++i] ?? args.config;
    else if (a === "--repo-root") args.repoRoot = argv[++i] ?? args.repoRoot;
    else if (a === "--dry-run") args.dryRun = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  args.repoRoot = resolve(args.repoRoot);
  args.config = resolve(args.repoRoot, args.config);
  return args;
}

const logger: Logger = {
  info: (m) => console.error(`[release] ${m}`), // stderr: keep stdout clean for outputs
  warn: (m) => console.error(`[release] WARN ${m}`),
};

/** Emit GitHub Actions outputs. Per-project keys + an aggregate hasChanges. */
function emitOutputs(results: readonly ProjectResult[]): void {
  const anyChanges = results.some((r) => r.release !== null);
  const lines: string[] = [`hasChanges=${anyChanges}`];

  for (const r of results) {
    if (r.release === null) continue;
    lines.push(`${r.tagPrefix}_version=${r.release.nextVersion}`);
    // multiline notes use the heredoc form GitHub Actions requires
    const delim = `NOTES_${r.tagPrefix}_EOF`;
    lines.push(`${r.tagPrefix}_notes<<${delim}`, r.notes.trimEnd(), delim);
  }

  const out = lines.join("\n") + "\n";
  process.stdout.write(out); // human-visible + pipeable
  const ghOutput = process.env["GITHUB_OUTPUT"];
  if (ghOutput) appendFileSync(ghOutput, out);
}

/**
 * `resolve-path <tagPrefix>`: print the config's repo-relative path for a prefix.
 * Lets the tag workflow find a project's package.json without hardcoding paths
 * or re-parsing config in bash — the tool (config) stays the single source of truth.
 */
function resolvePathCommand(argv: readonly string[]): number {
  // First positional = tagPrefix; remaining args (--config/--repo-root) parsed normally.
  const tagPrefix = argv[0];
  if (tagPrefix === undefined || tagPrefix.startsWith("--")) {
    throw new Error("resolve-path requires a <tagPrefix> argument");
  }
  const args = parseArgs(argv.slice(1));
  const config = loadConfig(args.config);
  process.stdout.write(pathForTagPrefix(config, tagPrefix) + "\n");
  return 0;
}

async function main(): Promise<number> {
  if (process.argv[2] === "resolve-path") {
    return resolvePathCommand(process.argv.slice(3));
  }

  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig(args.config);

  const ctx: ReleaseContext = {
    repoRoot: args.repoRoot,
    config,
    logger,
    git: createGitReader(args.repoRoot),
  };

  const results = await run(ctx, {
    resolver: resolvers.get(config.resolver),
    renderer: renderers.get(config.changelogRenderer),
  });

  if (!args.dryRun) {
    for (const r of results) applyResult(args.repoRoot, r);
  } else {
    logger.info("dry-run: no files written");
  }

  emitOutputs(results);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`[release] ERROR ${(err as Error).message}`);
    process.exit(1);
  },
);
