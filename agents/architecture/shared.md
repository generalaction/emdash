# Shared Modules

The desktop app no longer has a `src/shared/` directory. Shared code has an explicit owner under
`src/core/`:

- `src/core/primitives/<domain>/api/` contains portable vocabulary, schemas, and pure helpers.
- `src/core/features/<domain>/api/` contains feature Wire contracts.
- `src/core/features/<domain>/node/` contains main-process Wire controllers and event hosts.
- `src/core/features/<domain>/browser/` contains renderer stores, hooks, and UI.
- `src/core/features/<domain>/contributions/` exposes view, modal, tab, subject, and memento
  contributions.
- `src/core/services/` owns reusable active capabilities.
- `src/core/manifests/{shared,node,browser}/` are the application composition roots for portable
  contracts, main-process registries, and renderer contributions.

Renderer-main traffic uses Wire. The desktop contract is assembled in
`src/core/manifests/shared/desktop-wire-contract.ts`, served by
`src/main/gateway/desktop-wire.ts`, and
consumed through `src/renderer/lib/runtime/desktop-wire-client.ts`.
The shared manifest imports only slice API contracts. A drift test compares its keys and contract
references with the lazy Node controller registry in `src/core/manifests/node/controllers.ts`.

## Path Aliases

All aliases are defined in a single `tsconfig.json` and mirrored in `electron.vite.config.ts`:

| Alias | Resolves to |
| --- | --- |
| `@/*` | `src/*` |
| `@core/*` | `src/core/*` |
| `@renderer/*` | `src/renderer/*` |
| `@main/*` | `src/main/*` |
| `@root/*` | `./*` |

Aliases are resolved at build time by electron-vite. No runtime monkey-patching is needed.

## Provider Metadata Rules

When adding a provider:

1. add or update its plugin in `packages/plugins/src/agents/impl/` and register it in
   `packages/plugins/src/agents/registry.ts`
2. add any required env passthrough in `src/main/core/pty/pty-env.ts`
3. add or update hook/plugin installation and parsing in provider plugin behavior if the provider
   supports explicit events; the TUI runtime installs and hosts hooks
4. update renderer surfaces that consume agent metadata through the desktop Wire client
5. add tests for non-standard spawn or detection behavior
