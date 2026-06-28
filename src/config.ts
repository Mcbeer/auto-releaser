// Config loading + validation. Fails LOUD on bad input — a misconfigured release
// tool that runs anyway produces wrong versions silently, which is worse than crashing.

import { readFileSync } from "node:fs";
import type { Bump, ReleaseConfig, TrackedProject } from "./types.ts";

const DEFAULTS = {
  resolver: "pnpm",
  changelogRenderer: "grouped-by-package",
  includeDev: false,
  commitTypes: {
    feat: "minor",
    fix: "patch",
    perf: "patch",
    refactor: "patch",
    revert: "patch",
  } satisfies Record<string, Bump>,
} as const;

const VALID_BUMPS = new Set<Bump>(["major", "minor", "patch"]);

class ConfigError extends Error {}

/** Parse + validate a config object (already JSON-parsed). Throws ConfigError on any problem. */
export function validateConfig(raw: unknown): ReleaseConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ConfigError("Config must be a JSON object.");
  }
  const o = raw as Record<string, unknown>;

  const resolver = optionalString(o, "resolver", DEFAULTS.resolver);
  const changelogRenderer = optionalString(o, "changelogRenderer", DEFAULTS.changelogRenderer);

  if ("includeDev" in o && typeof o["includeDev"] !== "boolean") {
    throw new ConfigError(`"includeDev" must be a boolean.`);
  }
  const includeDev = (o["includeDev"] as boolean | undefined) ?? DEFAULTS.includeDev;

  const trackedProjects = validateTrackedProjects(o["trackedProjects"]);
  const commitTypes = validateCommitTypes(o["commitTypes"]);

  return { resolver, changelogRenderer, includeDev, trackedProjects, commitTypes };
}

/** Read + parse + validate a config file path. */
export function loadConfig(path: string): ReleaseConfig {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new ConfigError(`Cannot read config file: ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new ConfigError(`Config is not valid JSON (${path}): ${(e as Error).message}`);
  }
  return validateConfig(parsed);
}

function optionalString(o: Record<string, unknown>, key: string, fallback: string): string {
  if (!(key in o)) return fallback;
  const v = o[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new ConfigError(`"${key}" must be a non-empty string.`);
  }
  return v;
}

function validateTrackedProjects(v: unknown): TrackedProject[] {
  if (!Array.isArray(v) || v.length === 0) {
    throw new ConfigError(`"trackedProjects" must be a non-empty array.`);
  }
  const seenPrefixes = new Set<string>();
  const seenPaths = new Set<string>();
  return v.map((entry, i) => {
    if (typeof entry !== "object" || entry === null) {
      throw new ConfigError(`trackedProjects[${i}] must be an object.`);
    }
    const e = entry as Record<string, unknown>;
    const path = e["path"];
    const tagPrefix = e["tagPrefix"];
    if (typeof path !== "string" || path.trim() === "") {
      throw new ConfigError(`trackedProjects[${i}].path must be a non-empty string.`);
    }
    if (typeof tagPrefix !== "string" || tagPrefix.trim() === "") {
      throw new ConfigError(`trackedProjects[${i}].tagPrefix must be a non-empty string.`);
    }
    if (seenPrefixes.has(tagPrefix)) {
      throw new ConfigError(`Duplicate tagPrefix "${tagPrefix}" — tags would collide.`);
    }
    if (seenPaths.has(path)) {
      throw new ConfigError(`Duplicate path "${path}" — projects would overwrite each other's files.`);
    }
    seenPrefixes.add(tagPrefix);
    seenPaths.add(path);

    const rawExtra = e["extraFiles"];
    let extraFiles: string[] | undefined;
    if (rawExtra !== undefined) {
      if (!Array.isArray(rawExtra) || rawExtra.some((g) => typeof g !== "string" || g.trim() === "")) {
        throw new ConfigError(`trackedProjects[${i}].extraFiles must be an array of non-empty strings.`);
      }
      extraFiles = rawExtra as string[];
    }

    return extraFiles ? { path, tagPrefix, extraFiles } : { path, tagPrefix };
  });
}

function validateCommitTypes(v: unknown): Record<string, Bump> {
  if (v === undefined) return { ...DEFAULTS.commitTypes };
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new ConfigError(`"commitTypes" must be an object mapping type -> bump.`);
  }
  const out: Record<string, Bump> = {};
  for (const [type, bump] of Object.entries(v as Record<string, unknown>)) {
    if (typeof bump !== "string" || !VALID_BUMPS.has(bump as Bump)) {
      throw new ConfigError(
        `commitTypes["${type}"] must be one of major|minor|patch (got ${JSON.stringify(bump)}).`,
      );
    }
    out[type] = bump as Bump;
  }
  if (Object.keys(out).length === 0) {
    throw new ConfigError(`"commitTypes" cannot be empty.`);
  }
  return out;
}

/** Look up a tracked project's repo-relative path by its tagPrefix. Throws if unknown. */
export function pathForTagPrefix(config: ReleaseConfig, tagPrefix: string): string {
  const project = config.trackedProjects.find((p) => p.tagPrefix === tagPrefix);
  if (project === undefined) {
    const known = config.trackedProjects.map((p) => p.tagPrefix).join(", ");
    throw new ConfigError(`No tracked project with tagPrefix "${tagPrefix}". Known: ${known}`);
  }
  return project.path;
}

export { ConfigError };
