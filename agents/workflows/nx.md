# Nx In This Monorepo

Nx is the task orchestration and local caching layer for this pnpm workspace. It
sits on top of the existing tooling — `tsdown`, `electron-vite`, `vitest`, `oxlint`,
`oxfmt` — and adds dependency-ordered execution, input hashing, and output caching
without requiring any structural changes to packages.

No `project.json` files exist. Nx infers all six projects (five `packages/*` plus the
`apps/emdash-desktop` app) from `package.json` `workspace:*` dependencies and runs each
project's existing `package.json` scripts as Nx targets.

The Nx MCP server is enabled for this workspace. In Cursor, agents can query the
project graph, list targets, and run tasks through the MCP server directly without
shelling out.

## Project Graph

Nx derives this graph from `workspace:*` dependency references:

```
@emdash/shared    (leaf)
@emdash/core      -> shared
@emdash/plugins   -> core -> shared
@emdash/chat-ui   -> shared
@emdash/ui        -> chat-ui, shared
@emdash/emdash-desktop -> shared, core, plugins, ui, chat-ui
```

The `dependsOn: ["^build"]` default in `nx.json` means "build all upstream packages
before running this target." A bare `nx build @emdash/emdash-desktop` therefore
builds shared, core, plugins, chat-ui, and ui first, in dependency order, with
parallelism where the graph allows.

## Common Commands

All of these run from the repo root.

**Run a target for every project:**

```bash
pnpm run build          # nx run-many -t build --all
pnpm run test           # nx run-many -t test --all
pnpm run lint           # nx run-many -t lint --all
pnpm run typecheck      # nx run-many -t typecheck --all
pnpm run format:check   # nx run-many -t format:check --all
pnpm run format         # nx run-many -t format --all
```

**Start the full dev setup:**

```bash
pnpm run dev            # nx run-many -t dev --all --parallel=10
```

This builds upstream packages via the `dev -> ^build` dependency chain, then starts
all `dev` targets (tsdown watches + electron-vite dev) in parallel.

**Run only affected projects (relative to the default base branch):**

```bash
pnpm run affected       # nx affected -t lint typecheck test
```

**Visualize the project graph:**

```bash
pnpm run graph          # opens nx graph in the browser
```

**Address a single project or target directly:**

```bash
nx build @emdash/core
nx test @emdash/shared
nx typecheck @emdash/emdash-desktop
nx package:mac @emdash/emdash-desktop
nx db:reset @emdash/emdash-desktop
nx storybook @emdash/ui
nx theme:build @emdash/ui
```

**Run affected with a custom base:**

```bash
nx affected -t lint typecheck --base=main --head=HEAD
```

**List all projects:**

```bash
nx show projects
```

**Inspect a project's resolved targets:**

```bash
nx show project @emdash/core
nx show project @emdash/emdash-desktop
```

## Task Ordering

Nx uses the `dependsOn` declarations in `nx.json` to determine task order:

| Target         | Waits for upstream `build` first? | Cached? |
| -------------- | --------------------------------- | ------- |
| `build`        | yes (`^build`)                    | yes     |
| `typecheck`    | yes (`^build`)                    | yes     |
| `test`         | yes (`^build`)                    | yes     |
| `dev`          | yes (`^build`)                    | no      |
| `lint`         | no                                | yes     |
| `format:check` | no                                | yes     |
| `format`       | no                                | no      |

Targets not listed in `targetDefaults` (e.g. `package`, `rebuild`, `db:reset`,
`db:generate`) have no dependency ordering or caching applied and run as plain
`pnpm exec` calls.

## Local Caching

Nx hashes each task's inputs — source files, config files, `pnpm-lock.yaml`, and
`sharedGlobals` (`.oxlintrc.json`, `.oxfmtrc.json`) — and caches the output
artifacts and terminal output in `.nx/cache/`. A cache hit replays the output
instantly without re-running the task.

Cached output directories per project:
- `packages/*/dist/` — tsdown output
- `apps/emdash-desktop/out/` — electron-vite build output

**What is NOT cached** (intentionally, due to platform/environment sensitivity):
- `package`, `package:mac`, `package:linux`, `package:win` — electron-builder
  produces native platform artifacts and handles its own incremental logic.
- `rebuild` — Electron native module rebuild depends on the local Electron ABI.
- `run:docker-ssh`, `db:generate`, `db:reset` — side-effecting operations.
- `dev`, `format` — long-running or write-output operations.

**Bust the cache when needed:**

```bash
nx reset              # clears .nx/cache and .nx/workspace-data
```

The `.nx/` directory is gitignored and local to each machine.

## CI Integration

The `code-consistency-check.yml` workflow uses `nrwl/nx-set-shas@v4` to set
`NX_BASE` and `NX_HEAD` environment variables from the PR base and head SHAs, then
runs:

```bash
pnpm nx affected -t format:check typecheck lint
```

This means only the projects touched by the PR (and their dependents) are checked.
A PR that modifies only `packages/ui` will not re-run typecheck for the desktop app
unless it actually depends on changed output.

The `fetch-depth: 0` checkout is required for `nx-set-shas` to walk the full commit
history and determine which files changed relative to the base branch.

## Adding a New Package

When a new package is added under `packages/` or `apps/` that follows the same
script conventions (`build`, `test`, `lint`, `typecheck`, `format`, `format:check`),
Nx automatically picks it up at the next run. No `nx.json` changes are needed unless
the package needs non-default caching behavior (unusual output paths, skipped cache,
or a different `dependsOn`).

To override defaults for a specific project, add a `"nx"` key to that package's
`package.json`:

```json
{
  "nx": {
    "targets": {
      "build": {
        "outputs": ["{projectRoot}/dist", "{projectRoot}/types"]
      }
    }
  }
}
```
