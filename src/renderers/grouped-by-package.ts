// Built-in ChangelogRenderer: groups changes by the source package so devs see
// WHERE each change came from (parent doc §4.1.7). Markdown, deterministic order.

import type { ChangelogRenderer, ComputedRelease } from "../types.ts";

export const groupedByPackageRenderer: ChangelogRenderer = {
  name: "grouped-by-package",

  render(release: ComputedRelease): string {
    const lines: string[] = [`## ${release.nextVersion}`, ""];

    // Group subjects by source package.
    const byPackage = new Map<string, string[]>();
    for (const c of release.commits) {
      const list = byPackage.get(c.sourcePackage) ?? [];
      list.push(c.subject);
      byPackage.set(c.sourcePackage, list);
    }

    for (const pkg of [...byPackage.keys()].sort()) {
      lines.push(`### ${pkg}`, "");
      for (const subject of byPackage.get(pkg)!) {
        lines.push(`- ${subject}`);
      }
      lines.push("");
    }

    return lines.join("\n").trimEnd() + "\n";
  },
};
