# Dependency-Aware Release Tool — Design Doc

## Status

Design / proposal. Not yet built. This document is the spec for an agent to implement against.

---

## 1. Problem

We want automated semantic versioning + changelog + release PRs for the **kc-bff**
(`kids-creations/apps/backend-for-frontend`, package `@lego/kc-bff`), with one hard
requirement that off-the-shelf tools cannot satisfy:

> The BFF **bundles** ~18 internal monorepo packages (`workspace:*`) at build time
> (esbuild). When any of those packages — or their transitive `workspace:*`
> dependencies — change, that code ships inside the BFF artifact. Therefore a change
> to a bundled dependency **must count as a change to the BFF** and bump its version.

### Constraints (all non-negotiable, established during design)

1. **Automatic** dependency-aware bumps — a dep change bumps the BFF with no human action.
2. **No versioning** forced onto the dependency packages — they are internal-only,
   `private`, consumed via `workspace:*`, and must stay unversioned.
3. **No manual markers** — no per-PR changeset/change-file step. (This failed before with
   Changesets: people forgot, and changes silently didn't reach the BFF.)
4. **No bot commits to feature branches** — must not create the pull-before-push problem.

---

## 2. Why existing tools were rejected (verified, not assumed)

| Tool | Verdict | Reason (verified against docs) |
|------|---------|--------------------------------|
| **release-please** | ✗ | A component maps to exactly **one** path. Confirmed: "If you configure a `path`, Release Please will only consider commits that touch files on that path." No multi-path-per-component. The only dep-aware mechanism is the `node-workspace` plugin, which **requires every dependency to be release-please-managed (versioned + in the manifest)** — violates constraint 2. The only version-override input on the action is `release-as`, which is **sticky state requiring post-merge cleanup** (a bot commit-back) — violates constraint 4. There is no "inject pre-computed version/notes" input; the engine always recomputes from commits on the path. |
| **Changesets** | ✗ | Contributor writes a change file per change (manual marker) — violates constraint 3 (this is the exact workflow that failed before). Monorepo dep-bumping assumes versioned packages — violates constraint 2. |
| **semantic-release** | ✗ | Single-package by design (`tagFormat` has one `${version}`). Monorepo support is path-based commit filtering — same limitation as release-please. No external version input. |
| **Nx release** | ✗ (rejected by us) | Graph-first model would fit, but adopting Nx is too invasive for this repo. |
| **Turborepo** | ✗ | Has no release/versioning feature. Its own docs delegate to Changesets / `auto` / `beachball`. Turbo is a task runner + cache only. |
| **beachball** (Microsoft) | ✗ | Its **bump algorithm does exactly what we want**: a change to `fooLib` auto-bumps dependent `app` by patch through the workspace graph, transitively, by default. BUT the **trigger is still a human-authored change file** on the leaf package (`beachball change`), enforced by `beachball check` blocking the PR — violates constraint 3 — and leaf packages get versioned + changelogged — violates constraint 2. Strictly better than Changesets (CI-enforced so people can't forget), but still fails the same two constraints. |

### Root finding

Every off-the-shelf tool converges on the same assumption: **a release unit = a versioned
package, and bumps come from either commits-on-that-path or a hand-authored marker.** None
infer a bump purely from a `git diff` over *unversioned* dependency folders. Satisfying all
four constraints requires a custom tool.

---

## 3. Solution overview

A **standalone, repo-agnostic, config-driven CLI** (distributed like release-please — brought
into a repo, not living inside it). For the kids-app-platform it is consumed from a GitHub
workflow via `npx`.

### Core principle: the tool is a pure function

```
(git history + resolved dependency graph + config) → (new version, changelog text, edited files)
```

- **Stateless.** No GitHub API calls, no PR state, no tag writing inside the tool.
- The boundary that makes it portable: the tool **writes files and prints outputs**; the
  **workflow** wires those to existing GitHub Actions for PR creation and tagging.
- All stateful / mechanical concerns (rolling release PR, tagging, releases) are delegated to
  battle-tested actions — this is what keeps the tool small and avoids re-implementing the
  hardest part of release-please (idempotent PR lifecycle).

---

## 4. Architecture

### 4.1 The tool (pure CLI, e.g. run via `tsx`/node)

On invocation (runs on push/merge to `main`):

1. **Read config.**
2. For each **tracked project**: resolve its **transitive `workspace:*` dependency closure**
   (set of folders) via the configured resolver (pnpm for v1).
3. `git log <lastTag>..HEAD` to gather commits since the project's last release tag.
4. For each commit: parse the **conventional-commit** type and diff its **touched folders**.
5. **Attribute** a commit to a tracked project if any touched folder is within that project's
   dependency closure (the project's own folder included).
6. Compute the **max bump** across all attributed commits (`feat`→minor, `fix`/`perf`→patch,
   `!`/`BREAKING CHANGE`→major; configurable map). Take the highest.
7. Generate **grouped changelog** text (grouped by source package so devs see *where* each
   change came from).
8. **Write** updated `package.json` (version) and `CHANGELOG.md` for the project.
9. **Print** `version` and `hasChanges` (and changelog notes) to stdout / `$GITHUB_OUTPUT`
   for the workflow to consume.

### 4.2 The workflow (glue only, no logic)

- **On push/merge to `main`:** run the tool → if `hasChanges`, hand the edited files to a
  rolling-PR action (e.g. `peter-evans/create-pull-request`) which maintains a **single
  idempotent release PR per project** (branch e.g. `release/kc-bff`). This action owns all PR
  state and idempotency/concurrency — we do not build that.
- **On merge of the release PR:** a tagging/release action creates the tag
  (`<tagPrefix>-vX.Y.Z`) and GitHub release. Detect "this was the release PR" via the release
  branch name or a label — **do not** tag on every main merge.

---

## 5. Key design decisions (settled)

- **Squash merges.** This repo squash-merges to `main`: one commit on main = one merged PR =
  one conventional-commit subject. Simplifies parsing (subject = type/bump) and attribution
  (single commit diff = changed folders).
  - ⚠️ **Accuracy depends on squash-commit-subject hygiene.** The bump is only as good as the
    PR-title/commit-subject conventional-commit quality. Confirm the repo enforces PR-title
    linting. Where the type is read from (subject vs body vs PR title) should be configurable
    with a sensible default (subject).
- **State = git tags.** No separate state/manifest file to drift. "Since last release" = since
  the project's last `<tagPrefix>-v*` tag. Tag prefix is per-project config (e.g. `kc-bff`).
- **Dependency resolver is an interface.** v1 ships a **pnpm** implementation, but the resolver
  is pluggable (pnpm / turbo / others later) selected via config. This abstraction is designed
  in from day one because it is expensive to retrofit. (Open: exact pnpm command to return a
  package's transitive internal dependency set — needs verification before implementation,
  e.g. `pnpm list --filter "<pkg>..." --json` / `pnpm -F "<pkg>..." list`.)
- **Multi-project attribution is expected.** A single commit can land in multiple projects'
  release PRs. A change to a widely-used package (e.g. a types package) legitimately affects
  *everything* that bundles it. This is correct behavior, not a bug.
- **Distribution: npm package + `npx` first.** A GitHub Action wrapper (`uses: ...`) is a thin
  layer to add later. Start with the CLI.

---

## 6. Config schema (the public contract)

Small JSON/YAML file in the consuming repo. Minimal shape:

```jsonc
{
  "resolver": "pnpm",                 // dependency-graph resolver (pluggable; v1: pnpm)
  "trackedProjects": [
    {
      "path": "kids-creations/apps/backend-for-frontend",
      "tagPrefix": "kc-bff"           // tags look like kc-bff-v12.3.0
    }
  ],
  "commitTypes": {                     // conventional type -> bump
    "feat": "minor",
    "fix": "patch",
    "perf": "patch",
    "refactor": "patch",
    "revert": "patch"
    // breaking (`!` / BREAKING CHANGE) -> major, regardless of type
  },
  "ignorePatterns": []                 // DEFERRED: folders/files that don't count as a change
                                       // (tests, docs, snapshots). Leave key, implement later.
}
```

### Output contract

The tool writes `package.json` + `CHANGELOG.md` for each project with changes, then exits,
emitting to stdout / `$GITHUB_OUTPUT`:

- `hasChanges` (bool) — whether any tracked project needs a release.
- `version` — computed next version (per project).
- `notes` — changelog text (per project).

This boundary is how the tool plugs into any repo's workflow without knowing anything about
that repo.

---

## 7. Scope

### v1 (build this)

- Config parsing.
- pnpm transitive `workspace:*` closure resolution (behind a resolver interface).
- Conventional-commit parsing of squash commits since last tag.
- Commit → project attribution via dependency closure.
- Max-bump computation (incl. breaking → major).
- Grouped changelog generation (grouped by source package).
- Write `package.json` + `CHANGELOG.md`; print `version` / `hasChanges` / `notes`.
- Stateless CLI consumed via `npx` from a workflow.

### Explicitly deferred (YAGNI)

- GitHub Action wrapper (`uses:`) — npx is enough for v1.
- Additional resolvers (turbo, npm, yarn) — interface exists, only pnpm implemented.
- Comments on **feature** PRs ("this PR will trigger a BFF patch") — nice-to-have, phase 2.
  The rolling release PR itself already provides release visibility.
- `ignorePatterns` implementation — leave the config key.
- Version groups / linked versions — only one tracked project for now.
- Multi-branch / maintenance releases.

---

## 8. Known risks / things to verify before/while building

1. **Exact pnpm (or turbo) command** to programmatically return a package's transitive internal
   (`workspace:*`) dependency folder set. This is the one technical unknown the whole tool
   stands on. Verify before implementing the resolver. Must correctly handle `workspace:*`,
   transitivity, and pnpm **catalogs** (this repo uses `catalog:` for external deps — those are
   not internal and should be ignored by closure resolution).
2. **Conventional-commit source under squash** — confirm type reliably lives in the commit
   subject (PR title). Make configurable; degrade gracefully if a subject isn't a valid
   conventional commit (e.g. treat as no-bump, or a configurable default).
3. **Bootstrap / first run** — no prior tag for a project: define behavior (e.g. seed from
   current `package.json` version, or take all history).
4. **No-op safety** — if nothing relevant changed, emit `hasChanges=false` and produce **no**
   PR (must not open empty release PRs).
5. **Release-PR detection on merge** — reliably distinguish "release PR merged → tag now" from
   ordinary main merges, via release branch name or label.

---

## 9. Current repo context (for the implementer)

- Monorepo: pnpm workspaces (v9.x) + Turborepo, Node 22.x.
- Target project: `@lego/kc-bff` at `kids-creations/apps/backend-for-frontend`, currently
  version `12.2.0`.
- The BFF declares ~18 `workspace:*` dependencies (e.g. `@lego/feature-games-backend`,
  `@lego/kc-types`, etc.) plus `catalog:` external deps. External `catalog:` deps are **out of
  scope** for closure resolution; only `workspace:*` internal packages matter.
- The BFF bundles its dependencies at build time via esbuild (`build.js`), which is the
  justification for treating dependency changes as BFF changes.
- An earlier in-branch attempt wired release-please for the BFF
  (`release-please-config.json`, `.release-please-manifest.json`,
  `.github/workflows/kids-creations-bff-release-please.yml`). This tool is intended to
  **replace** that approach. Those files can be removed when this tool is adopted.
```
