# Extensibility & Resolver Design — Companion to DEP-AWARE-RELEASE-TOOL-DESIGN.md

## Status

Design / proposal. Extends the parent design doc with (a) the **verified** dependency-graph
resolution mechanism and (b) the **extensibility architecture**. Where a claim was verified
empirically, it is marked ✅ VERIFIED with the evidence. Where it is a design judgment (not yet
proven), it is marked ⚖️ JUDGMENT so it can be challenged.

---

## 1. Extensibility goal (settled with stakeholder)

- **Design the contract as if third parties will implement it** (typed, named, documented seams),
  but **do not build distribution machinery** (npm plugin discovery, dynamic import, versioned
  public API) yet.
- **Loading mechanism: named built-ins via config string.** A registry maps a name → a built-in
  implementation. "Going public later" = letting external code register into that same map,
  **without changing any interface a plugin implements.** The registry IS the public seam.

### Why named-registry over lifecycle hooks (evidence-based)

✅ VERIFIED (primary sources):
- **semantic-release** is an end-to-end **lifecycle-hook plugin model** (`verifyConditions`,
  `analyzeCommits`, `generateNotes`, `prepare`, `publish`, `addChannel`, `success`, `fail`).
  Plugins are npm modules implementing one or more steps; multiple plugins compose per step.
- **release-please** uses **named strategy interfaces** instead: `VersioningStrategy`
  (`default` / `always-bump-patch` / ...) and `ChangelogNotes` (`default` / `github`), each
  "create a class that implements the interface," selected by name in config.

⚖️ JUDGMENT: We follow the **release-please** style, not semantic-release's. Reason: the parent
design doc deliberately delegates *publishing / tagging / PR-state* to GitHub Actions, so the
hook steps that justify semantic-release's machinery (`publish`, `addChannel`, `success`, `fail`,
`verifyConditions`) **do not exist in our tool**. The steps that remain (resolve graph → attribute
→ bump → render notes → write files) map cleanly onto interface-per-concern. Importing the hook
model would add surface for steps we pushed out of scope.

---

## 2. The dependency-graph resolver (the load-bearing seam)

This is the parent doc's §8.1 "one technical unknown the whole tool stands on." It is now resolved.

### 2.1 Verified package-manager capabilities

Tested by building real workspace fixtures (`bff → {games, types(prod), external}`,
`games → util`, `util → types`, `types → unrelated(devDep)`) and running each PM.
Correct prod closure for `bff` = `{games, types, util}`.

| Capability | pnpm | yarn | npm |
|---|---|---|---|
| Rooted at one package | ✅ `-F "pkg..."` | ❌ whole-project adjacency only | ✅ `#pkg .workspace` |
| Transitive traversal done by the PM | ✅ | ❌ (you traverse) | ✅ |
| Excludes external deps | ✅ `--only-projects` | ✅ (workspaces only) | ✅ (`.workspace`) |
| Prod/dev filtering along path | ✅ `--prod` | ❌ not exposed | ⚠️ unreliable (`:not(.dev)` leaked the devDep) |
| Output shape | flat path list | NDJSON adjacency | object array w/ `location` |

✅ VERIFIED — **the three PMs do not agree on the shape or completeness of the answer.** pnpm does
the whole job; yarn returns only a raw adjacency list with no prod/dev info; npm traverses but
cannot reliably prod-filter via selectors.

### 2.2 Consequence for the abstraction

⚖️ JUDGMENT (forced by the evidence above): the resolver interface must be drawn at the level
**all three PMs can satisfy**, and the graph algorithm must live in **shared tool code**, not in
the per-PM adapter. If the closure algorithm lived in the adapter, pnpm and yarn could compute
*different* closures for the same repo — a correctness bug exactly where the tool must be trusted.

- **Adapter's only job:** report the raw internal workspace graph (per package: folder + direct
  internal prod deps + direct internal dev deps, kept separate).
- **Shared code's job:** transitive closure + prod/dev policy + cycle safety.

### 2.3 Verified pnpm adapter command

✅ VERIFIED on pnpm 9.15.0 AND 11.9.0 (latest) — both the raw command and the real resolver
module produce identical, correct closures (catalog externals excluded). The closure command/API
is stable across pnpm 9/10/11. The built-in resolver targets latest pnpm:

```
pnpm list --parseable --only-projects --prod --depth Infinity --filter "<pkg>..."
```

- `--parseable` → flat newline-delimited absolute paths (the correct format to parse).
  ⚠️ `--json` is a TRAP: even with `--prod` it lists all filtered projects as top-level
  siblings, leaking the dev-only package. Use `--parseable`.
- `--only-projects` → internal workspace packages only (excludes all `catalog:` externals).
- `--prod` → excludes the dev-only dependency path.
- `--depth Infinity` → transitive.

✅ VERIFIED edge cases (combined fixture: named+default catalogs, `workspace:^`/`~`/`*`, a
`games ⇄ util` cycle):
- Default `catalog:` AND named `catalog:react18` externals both excluded.
- `workspace:^`, `workspace:~`, `workspace:*` all resolve identically (suffix is irrelevant to
  membership).
- Cyclic workspace deps: pnpm **warns but does not fail**; closure command returns correct
  deduped set.

### 2.4 Verified shared closure algorithm

✅ VERIFIED: a visited-set DFS over the normalized graph terminates on the `games ⇄ util` cycle
(6 iterations, correct result) and the `includeDev` toggle correctly includes/excludes the
dev-only package. The cycle guard MUST live here (shared), because the yarn adapter returns a raw
adjacency list and would otherwise be able to hang where pnpm does not.

---

## 3. Proposed interfaces

⚖️ All of §3 is JUDGMENT (the seam boundaries are a design choice, not a tested fact).

### 3.1 Ambient context (immutable, capability-segregated)

One `ReleaseContext` passed to every seam (stakeholder choice). Guardrails to avoid the
god-object failure mode: deeply `readonly`, and every field is a narrow capability *interface*
(so it stays mockable and additively-growable), never concrete singletons.

```ts
interface ReleaseContext {
  readonly repoRoot: string;
  readonly config: ReleaseConfig;   // already validated + frozen
  readonly logger: Logger;          // capability interface
  readonly git: GitReader;          // read-only: log / diff / tags
  // future capabilities added here additively; never breaks an existing plugin
}
```

### 3.2 Seam 1 — WorkspaceGraphProvider (was "Resolver")

Renamed to reflect the verified-narrowed job: report the graph, do NOT compute the closure.

```ts
interface WorkspaceGraphProvider {
  readonly name: string;                               // "pnpm" | "yarn" | "npm"
  readWorkspaceGraph(ctx: ReleaseContext): Promise<WorkspaceGraph>;
}

interface WorkspaceGraph {
  packages: ReadonlyArray<{
    name: string;
    dir: string;            // absolute folder path
    internalDeps: string[]; // names, prod
    internalDevDeps: string[]; // names, dev — separate ON PURPOSE (prod/dev policy is ours)
  }>;
}

// SHARED, package-manager-agnostic. Cycle-safe (verified). Not a seam.
function resolveClosure(
  graph: WorkspaceGraph,
  root: string,
  opts: { includeDev: boolean },
): Set<string>; // set of package names; map to dirs via graph
```

### 3.3 Seam 2 — ChangelogRenderer

Mirrors release-please's `ChangelogNotes`. Built-in: `grouped-by-package`.

```ts
interface ChangelogRenderer {
  readonly name: string;                          // "grouped-by-package"
  render(release: ComputedRelease, ctx: ReleaseContext): string;
}
```

### 3.4 The registry (the public seam)

```ts
class Registry<T extends { name: string }> {
  private impls = new Map<string, T>();
  register(impl: T): void { this.impls.set(impl.name, impl); }
  get(name: string): T { /* throw listing known names if missing */ }
}
// v1: only built-ins registered. Public later = external .register() — no interface change.
```

### 3.5 What is deliberately NOT a seam in v1 (YAGNI)

⚖️ JUDGMENT — kept as internal functions, promotable later if a real need appears:
- Commit parsing (subject/body/PR-title source, type→bump map) — pure **config**, no algorithm.
- Attribution (folder-in-closure) — fixed rule; internal function.
- Bump policy (max-bump) — internal function.
- Output writer (`package.json` + `CHANGELOG.md` + stdout contract) — internal; this contract is
  the whole portability story, so plugins must not be able to break it.

---

## 4. Verified conventional-commit semantics (for the bump step)

✅ VERIFIED against Conventional Commits 1.0.0:
- `fix` → PATCH, `feat` → MINOR, breaking → MAJOR.
- Breaking is signaled by **either** `!` in the prefix **or** a `BREAKING CHANGE:` footer — both
  must be parsed (not just `!`).
- Spec is case-insensitive **except** `BREAKING CHANGE`, which must be uppercase.
- `revert` has **no** spec-defined bump; the parent doc's `revert → patch` is a valid local
  extension, not a standard.
- The squash workflow (parent doc §5) is explicitly endorsed by the spec.

---

## 5. Idempotency invariant (no version drift) — VERIFIED + load-bearing

The tool computes `nextVersion = applyBump(currentVersion, maxBump(commits since lastTag))`,
where `currentVersion` is read from `package.json` and `lastTag` is the latest `prefix-v*` tag.
The tool **never writes tags** (tagging is delegated, parent doc §3).

✅ VERIFIED (fixture: repeated merges to main): on every ordinary merge, the tool re-reads
main's unchanged `package.json` and recomputes the **same** version — no drift across re-runs.
After the release merges and its tag is created, the post-tag commit range is empty →
`hasChanges=false` → no PR. Then a new feature advances exactly one step.

### The invariant that makes this true

`package.json` version and the latest tag MUST stay in lockstep on `main`. Skew
(package.json ahead of tag) causes silent, self-compounding over-bumping (✅ VERIFIED: with
package.json=12.3.0 and tag=v12.2.0, a feat yields 12.4.0 — wrong).

⚖️ DECISION (settled with stakeholder): the **release-PR merge is EXCLUDED from triggering the
tool** (workflow detects it by release branch name / label, parent doc §8.5). Only the tagging
action runs on that merge. Therefore the one moment when `package.json` is ahead of the tag (the
release merge itself) is exactly the moment the tool sits out — so the tool never observes skew
in normal operation. No in-tool "consistency guard" is added: it would (a) false-positive on the
benign release-merge window and (b) duplicate protection the workflow gating already provides.

⚠️ CONSEQUENCE: correctness of no-drift now depends ENTIRELY on the workflow reliably detecting
and excluding the release-PR merge (§8.5). If that detection misfires, skew + over-bumping
returns. This is the single highest-risk piece of the (unbuilt) workflow glue.

---

## 5b. §8.5 release detection + the push/tag RACE (verified)

✅ VERIFIED (GitHub docs): the canonical "run on PR merge" trigger is
`on: pull_request: types: [closed]` + `if: github.event.pull_request.merged == true`.
The merged release PR's head branch is `github.event.pull_request.head.ref` (= `release/<prefix>`),
authoritatively available — NOT inferred from commit messages (squash merges erase merge info).

⚠️ VERIFIED RACE (fixture): when the release PR merges, main also gets a `push`, so the
**push-triggered tool also runs** on the release commit. If it runs while `package.json` is already
bumped (e.g. 12.4.0) but the tag (`v12.4.0`) does not yet exist, the tool reads `lastTag=v12.2.0` +
the feature commits and emits a **spurious 12.5.0** — exactly the drift the stakeholder feared.

✅ VERIFIED FIX — ordering, not message-matching: if the tag for the release version is created
**before** the tool's push-run reads tags, the commit range since that tag is empty →
`hasChanges=false` → no bogus PR. Confirmed in a fixture.

⚖️ DESIGN (race-free):
- **Tag workflow** (`pull_request: closed`, `merged==true`, head.ref starts with `release/`):
  create `<prefix>-v<version>` from the merged `package.json`. This is the ONLY tag writer.
- **Push workflow** (`push: main`): run the tool. To avoid the race it must NOT act on the release
  commit before its tag exists. Two robust guards (use at least one):
  1. The release PR is merged with a path that the push workflow can detect, OR
  2. Simpler/robust: the tool is naturally safe ONCE the tag exists; ensure tag creation is not
     gated behind the push run. Since the tag job triggers on the `pull_request closed` event
     (fires effectively concurrently with the push), add a guard in the push workflow:
     **skip if HEAD is a release commit** (detect via the release branch having just merged /
     a `chore(release)` marker), letting the tag job win. This guard is the load-bearing piece
     and MUST be verified on a real Actions run (cannot be proven locally).

⚠️ The push/tag concurrency is the single highest-risk unverified piece; local fixtures prove the
tool's behavior given an ordering, but not GitHub's actual event concurrency.

---

## 5c. Real-world validation on GitHub (✅ DONE)

Validated end-to-end in `Mcbeer/auto-releaser-sandbox` (private pnpm workspace mirroring kc-bff:
`@sandbox/bff` bundling `@sandbox/games`→`util`→`types`, plus a `catalog:` external). Tool vendored
under `.release-tool/`, run via `node ./.release-tool/src/cli.ts` (npx/CLI form).

Full lifecycle that PASSED on real Actions:
1. `feat` in `@sandbox/games` merged → push workflow ran → release PR "chore(release): bff 1.1.0"
   opened with correct `package.json` (1.0.0→1.1.0) + grouped CHANGELOG.
2. Release PR squash-merged → **two runs fired simultaneously**: `release-tag` (pull_request)
   = success, created `bff-v1.1.0`; `release` (push) = **skipped** via the `chore(release):` guard.
   ✅ **The push/tag race did NOT occur** — the guard worked; no spurious bump.
3. Next `feat` → tool computed `1.2.0` (one step above released 1.1.0). ✅ **No drift.**

### Real-environment gotchas (local testing could NOT catch these)
- `pnpm/action-setup@v4` requires a pnpm version — fixed by adding `packageManager` to root
  `package.json` (the real monorepo already pins this).
- **"GitHub Actions is not permitted to create or approve pull requests"** — a repo/org setting,
  off by default. Must enable `default_workflow_permissions=write` +
  `can_approve_pull_request_reviews=true` (Settings → Actions, or the API). This will need
  enabling on the real kids-app-platform repo.

### Multi-project — ✅ VALIDATED on real GitHub
Sandbox extended to track TWO projects (`bff` + `admin`, both bundling `@sandbox/games`).
- Code audit: orchestrate/cli/writers all loop correctly; only gap was missing duplicate-PATH
  validation (two prefixes → same folder → CHANGELOG overwrite). FIXED + tested.
- Tool emits `changedProjects` JSON; the push workflow uses a **matrix** (`detect` job →
  per-project `release-pr` jobs), each PR scoped to its project via `add-paths`.
- Verified on Actions: a shared-dep `feat` opened TWO isolated PRs (`release/bff` with only
  `apps/bff/*`; `release/admin` with only `apps/admin/*`). Merging both created independent tags
  `bff-v1.2.0` + `admin-v3.1.0`; both push jobs skipped via the `chore(release):` guard.
- Isolation confirmed: an admin-only `fix` produced `changedProjects` containing ONLY admin
  (3.1.0→3.1.1); bff correctly absent.

Multi-project real-environment gotchas caught:
- `--frozen-lockfile` fails if `pnpm-lock.yaml` isn't regenerated after adding a package
  (`pnpm install --lockfile-only --config.confirmModulesPurge=false`).

✅ RESOLVED — changelog notes in per-project PR bodies: notes are embedded in each
`changedProjects[]` object. `JSON.stringify` escapes newlines → survives the single-line
`GITHUB_OUTPUT` value → `fromJSON` in the matrix recovers the multiline markdown → used as the PR
`body:`. Verified on real Actions: both PRs rendered correct grouped-by-package changelogs
(admin's PR even grouped two source packages). Unit-tested via buildOutputs (src/outputs.ts) incl.
the critical multiline round-trip.

### Still NOT validated
- `merge_commit_sha` checkout path under squash (tag workflow used it; runs succeeded but not
  asserted in isolation).
- Concurrency under rapid successive merges (only sequential merges tested).
- Distribution as a real `uses:` Action (action.yml) — still deferred; tested vendored CLI form.

---

## 6. Remaining unverified items (do before/while implementing)

1. ✅ RESOLVED — pnpm closure verified on 9.15.0 AND 11.9.0 (latest); command/API stable across majors.
2. ⚠️ yarn/npm adapters: only the *graph-reporting* commands were verified, not a full adapter.
3. Bootstrap / first-run with no prior tag (parent doc §8.3) — still open.
4. ⚠️ Workflow §8.5 release-PR-merge detection — load-bearing for no-drift (see §5); unbuilt.
