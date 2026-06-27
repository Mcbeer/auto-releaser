import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CommitInfo, GitReader } from "./types.ts";

const execFileAsync = promisify(execFile);

// Control-char separators chosen because they don't occur in normal commit
// messages. VERIFIED empirically against a real repo (multi-line bodies with a
// BREAKING CHANGE footer parse cleanly):
//   --format="<RS>%H%n%B<US>"  + --name-only
//   RS (0x1e) starts each record; line 1 = sha; message = between first \n and US;
//   file paths follow the US, one per line.
const RS = "\x1e";
const US = "\x1f";
const LOG_FORMAT = `${RS}%H%n%B${US}`;

export function createGitReader(repoRoot: string): GitReader {
  async function git(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", args, {
      cwd: repoRoot,
      maxBuffer: 256 * 1024 * 1024,
    });
    return stdout;
  }

  return {
    async log(sinceRef: string | null): Promise<readonly CommitInfo[]> {
      // First run (no tag): whole history. Otherwise sinceRef..HEAD (exclusive).
      const range = sinceRef === null ? "HEAD" : `${sinceRef}..HEAD`;
      const stdout = await git(["log", range, "--name-only", `--format=${LOG_FORMAT}`]);

      const commits: CommitInfo[] = [];
      for (const record of stdout.split(RS)) {
        if (record.trim() === "") continue;

        const firstNewline = record.indexOf("\n");
        const sha = record.slice(0, firstNewline).trim();
        const rest = record.slice(firstNewline + 1);

        const usIndex = rest.indexOf(US);
        const message = rest.slice(0, usIndex).replace(/\n$/, ""); // %B has trailing \n
        const filesBlock = rest.slice(usIndex + 1);

        const changedPaths = filesBlock
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l !== "");

        commits.push({ sha, message, changedPaths });
      }
      return commits;
    },

    async lastTag(prefix: string): Promise<string | null> {
      // Highest version among prefix-v* tags. --sort=-version:refname orders
      // semver-aware (verified: 12.2.0 beats 12.1.0; foreign prefixes excluded).
      const stdout = await git([
        "tag",
        "--list",
        `${prefix}-v*`,
        "--sort=-version:refname",
      ]);
      const first = stdout.split("\n").map((l) => l.trim()).find((l) => l !== "");
      return first ?? null;
    },
  };
}
