// File writers: bump package.json version, prepend changelog notes.
// Preserves package.json formatting by editing only the version line's value.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ProjectResult } from "./orchestrate.ts";

/** Update the "version" field in package.json, preserving indentation/key order. */
export function writeVersion(repoRoot: string, projectPath: string, version: string): void {
  const pkgPath = join(repoRoot, projectPath, "package.json");
  const text = readFileSync(pkgPath, "utf8");
  // Replace only the version value; keep the rest of the file byte-for-byte.
  const updated = text.replace(
    /("version"\s*:\s*")[^"]*(")/,
    (_m, pre: string, post: string) => `${pre}${version}${post}`,
  );
  if (updated === text) {
    throw new Error(`Could not find a "version" field to update in ${pkgPath}`);
  }
  writeFileSync(pkgPath, updated);
}

/** Prepend the release notes to CHANGELOG.md (create if absent). */
export function writeChangelog(repoRoot: string, projectPath: string, notes: string): void {
  const path = join(repoRoot, projectPath, "CHANGELOG.md");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const header = "# Changelog\n\n";
  const body = existing.startsWith(header) ? existing.slice(header.length) : existing;
  writeFileSync(path, header + notes.trimEnd() + "\n\n" + body);
}

/** Apply both writes for a result that has a release. No-op for null releases. */
export function applyResult(repoRoot: string, result: ProjectResult): void {
  if (result.release === null) return;
  writeVersion(repoRoot, result.projectPath, result.release.nextVersion);
  writeChangelog(repoRoot, result.projectPath, result.notes);
}
