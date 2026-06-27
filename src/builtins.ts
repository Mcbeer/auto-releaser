// v1 wiring: register only built-ins. "Going public" later = external .register()
// calls into these same registries, with zero interface change.

import { Registry } from "./registry.ts";
import type { ChangelogRenderer, WorkspaceGraphProvider } from "./types.ts";
import { pnpmResolver } from "./resolvers/pnpm.ts";
import { groupedByPackageRenderer } from "./renderers/grouped-by-package.ts";

export const resolvers = new Registry<WorkspaceGraphProvider>();
resolvers.register(pnpmResolver);

export const renderers = new Registry<ChangelogRenderer>();
renderers.register(groupedByPackageRenderer);
