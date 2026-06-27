// Conventional Commit parsing. Rules VERIFIED against Conventional Commits 1.0.0:
// - subject form: `type(scope)!: description`
// - breaking signaled by `!` in prefix OR a `BREAKING CHANGE:` (or `BREAKING-CHANGE:`) footer
// - case-insensitive EXCEPT the literal `BREAKING CHANGE` token, which must be uppercase
// - type -> bump is config-driven; breaking always -> major regardless of type
// - non-conforming subjects are not fatal (parsed.type === null)

import type { Bump, ReleaseConfig } from "./types.ts";

export interface ParsedCommit {
  /** Lowercased type (e.g. "feat"), or null if the subject isn't conventional. */
  readonly type: string | null;
  readonly scope: string | null;
  readonly breaking: boolean;
  readonly description: string;
}

// type(scope)!: description  — scope and ! optional. Type is a word; case-insensitive.
const SUBJECT_RE = /^(?<type>[a-zA-Z]+)(?:\((?<scope>[^()]+)\))?(?<bang>!)?:\s(?<desc>.+)$/;

// Footer breaking marker. MUST be uppercase per spec; `BREAKING-CHANGE` is synonymous.
const BREAKING_FOOTER_RE = /^BREAKING[ -]CHANGE:\s?.+/m;

/**
 * Parse a full commit message (subject on the first line; optional body/footers after).
 * Under squash merges the subject is the PR title and the body may carry footers.
 */
export function parseCommit(message: string): ParsedCommit {
  const firstNewline = message.indexOf("\n");
  const subject = (firstNewline === -1 ? message : message.slice(0, firstNewline)).trim();
  const body = firstNewline === -1 ? "" : message.slice(firstNewline + 1);

  const m = SUBJECT_RE.exec(subject);
  if (m?.groups === undefined) {
    return { type: null, scope: null, breaking: false, description: subject };
  }

  const breakingFromBang = m.groups["bang"] === "!";
  const breakingFromFooter = BREAKING_FOOTER_RE.test(body);

  return {
    type: m.groups["type"]!.toLowerCase(),
    scope: m.groups["scope"] ?? null,
    breaking: breakingFromBang || breakingFromFooter,
    description: m.groups["desc"]!,
  };
}

/**
 * Bump for a single commit given the config type->bump map.
 * Breaking always wins (major). Unknown/non-conforming types yield null (no bump).
 */
export function commitBump(parsed: ParsedCommit, config: ReleaseConfig): Bump | null {
  if (parsed.breaking) return "major";
  if (parsed.type === null) return null;
  return config.commitTypes[parsed.type] ?? null;
}
