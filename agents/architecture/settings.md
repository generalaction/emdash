# Settings Ownership And Precedence

This page is the authoritative map for settings that affect project and workspace execution.
Do not introduce another merged project-settings bag. Read raw values from the owning domain and
use the named resolver listed below when a field has multiple layers.

"Personal" means **host-local personal config**: data stored by the workspace registry on that
machine. It is not an account-wide user profile, is not shared with the team, and is not synced to
other machines. "Team" means a repository or working-directory `.emdash.json` that can be
committed and shared.

## Field Ownership

| Field | Owning store | Effective precedence | Resolver | Main execution consumers |
| --- | --- | --- | --- | --- |
| `scripts.prepare` | Workspace registry host-local personal config; team `.emdash.json` | host-local personal > that workspace's team file > unset | `resolveProjectConfig()` in `packages/core/src/runtimes/workspace-registry/node/project-config.ts` | Workspace registry creation/lifecycle sequencing in `packages/core/src/runtimes/workspace-registry/node/runtime.ts` |
| `scripts.setup` | Workspace registry host-local personal config; team `.emdash.json` | host-local personal > that workspace's team file > unset | `resolveProjectConfig()` | Workspace registry activation and lifecycle sequencing |
| `scripts.run` | Workspace registry host-local personal config; team `.emdash.json` | host-local personal > that workspace's team file > unset | `resolveProjectConfig()` | Workspace registry activation and lifecycle sequencing |
| `scripts.teardown` | Workspace registry host-local personal config; team `.emdash.json` | host-local personal > that workspace's team file > unset | `resolveProjectConfig()` | Workspace registry deactivation and lifecycle sequencing |
| `autoRunSetup` | Workspace registry host-local personal config | host-local personal > built-in `true` | `resolveProjectConfig()` | Workspace registry activation gate and lifecycle sequencing |
| `autoRunRun` | Workspace registry host-local personal config | host-local personal > built-in `false` | `resolveProjectConfig()` | Workspace registry activation gate and lifecycle sequencing |
| `preservePatterns` | Workspace registry host-local personal config; team `.emdash.json` | host-local personal > that workspace's team file > built-in `[]`; arrays replace | `resolveProjectConfig()` | Worktree create/update copy-artifact steps |
| `env` | Workspace registry host-local personal config | host-local personal > unset | `resolveProjectConfig()` | Task terminals, lifecycle scripts, and TUI/ACP agent launches |
| `shellSetup` | Team `.emdash.json`; host settings JSON | that workspace's team file > host default > unset | `resolveProjectConfig()` | Workspace lifecycle script launches and task-session launch context resolution |
| `tmux` | Desktop project-settings DB override; host settings JSON; desktop app setting `project.tmuxByDefault` | stored project override > host default > app default | `resolveTmux()` in `apps/emdash-desktop/src/core/primitives/project-settings/api/effective-settings.ts` | Task-session launch context resolution and project-session teardown |
| `worktreeRoot` | Desktop project-settings DB override; host settings JSON; built-in host path | stored project override > host default > `<host-home>/emdash/worktrees` | `resolveWorktreeRoot()` in `apps/emdash-desktop/src/core/primitives/project-settings/api/effective-settings.ts` | `WorkspacePlacementResolver`, task creation, and destination previews |
| `defaultBranch` | Desktop project-settings DB; live repository facts | valid stored branch > remote HEAD > well-known remote branch > well-known local branch > unavailable | `resolveEffectiveSettings()` / `resolveEffectiveGitSettings()` in `apps/emdash-desktop/src/core/primitives/project-settings/api/effective-settings.ts` | Task and terminal environment, task creation, automation deployment, source-control UI |
| `baseRemote` | Desktop project-settings DB; live repository facts | valid stored remote > `origin` > sole remote > first remote alphabetically > unavailable | `resolveEffectiveSettings()` / `resolveEffectiveGitSettings()` | Git fetch, task creation, automation deployment, source-control UI |
| `pushRemote` | Desktop project-settings DB; effective base remote | valid stored remote > effective base remote > unavailable | `resolveEffectiveSettings()` / `resolveEffectiveGitSettings()` | Push and pull-request flows, automation deployment, source-control UI |
| `integrationAccounts[providerId]` | Desktop project-settings DB integration-accounts domain; connected provider accounts | stored account/explicit none > provider default > none; dangling pins fail closed. Repository-scoped operations additionally constrain inference and pins by repository host: matching default > sole host-matching account > none | `resolveProjectAccount()` supplies project base-remote or explicit URL context to `resolveProviderAccount()` | Issue integrations, GitHub pull requests and Git credentials, account selection UI |
| `agentGitCredentials` | Desktop project-settings DB | stored project choice > built-in `effective-account` | `getStoredGitSettings()` plus `DEFAULT_AGENT_GIT_CREDENTIALS` | `createGitCredentialsService()` for TUI, terminal, and source-control session credentials |
| `watcherExclude` | Local desktop app settings for the local worker; host settings JSON for remote workspace servers | worker-specific stored value > shared built-in exclusion list. With “Sync local settings” enabled, the desktop value is copied to the remote host (last writer wins; this is synchronization, not a precedence layer). | Files, Git, and workspace-registry worker construction in `apps/emdash-desktop/src/main/gateway/desktop-workers.ts` and `apps/workspace-server/src/gateway/workspace-workers.ts` | Files runtime watchers, Git checkout and workspace-registry working-tree watchers (through the `workspaceContentWatchIgnore` profile in `fs-watch`), and file-search exclusion policy |

## Domain Boundaries

- `ProjectSettingsProvider` exposes stored Git identity, stored integration account choices, stored placement, placement context, and
  resolver-backed tmux. Its only current-settings write is `setWorktreeRoot()`, which validates the
  directory on the owning Host. `DesktopProjectSettingsAuthority` owns patches to Git identity,
  integration account choices, and tmux, including when the Host is offline.
- Every desktop settings writer, including lazy migration write-back, lifecycle finalization and
  worktree-root updates, uses `ProjectSettingsStorage.mutate()`. Host/repository lookups finish
  before its synchronous transaction; patches are applied to the current row inside it.
- Desktop DB JSON stores only explicit project overrides. `tmuxDefaultMigrated` is one-time lazy
  migration metadata, not a user setting.
- Project settings pages are self-contained domain snapshots. Forms patch only touched fields;
  `null` removes an explicit value and restores inheritance.
- Integration account choices are their own desktop-owned domain, independent of Git identity.
  Account patches merge only touched provider keys; GitHub uses the same map and patch contract.
  Legacy GitHub account fields are normalized through `readStoredProjectSettings()` and its shared
  migration before reads, edits, and account-usage counts; current writes store only the map.
- All provider account surfaces, including GitHub, observe the same browser inventory query.
  Account availability and loading/error state come from that inventory; live connection checks
  report health separately and never update saved accounts or credentials. GitHub and form-based
  integrations share credential verification and stable-identity checks; token presence alone is
  not a successful health check. Reconnecting validates
  identity against account metadata even when the previous secret is missing or unreadable.
  GitHub refines the shared summary with required identity fields; historical metadata is normalized
  at the registry read seam. Account removal always names one account.
- Cached issue requests carry the account context in their query key. The server compares it with
  the authoritative resolution snapshot, then fetches credentials for that exact account ID.
  Stale contexts trigger inventory/settings refresh; invalidation ordering is not an identity guarantee.
- Single-account credential imports share `LegacyAccountImports` in
  `services/provider-accounts/node/migrations/`. Provider migration adapters own legacy decoding
  and any required identity lookup. A durable DB marker records completion independently of account
  existence and source cleanup. Registry upserts and imports use the same account writer; imports
  commit the account row and completion marker in one database transaction after secret I/O.
  Cleanup failures retry without authorizing another import; migration reads/deletes propagate
  storage errors. Historical GitHub completion timestamps remain
  recognized at this migration seam.
- Issue list/search execution shares one implementation for request limits, empty searches,
  plugin results, and linked-account identity. Provider adapters prepare credentials and repository
  context; GitHub retains repository recognition and host matching.
- Project account rows use the same explicit-disable and inheritance/reset choices for every
  integration, including when a pinned account is missing. GitHub authentication events carry flow
  state only; project UI reads its effective account rather than a global current-user projection.
- Linked issue refresh uses its saved source account despite a changed or dangling project account
  choice. An explicit project disable still suppresses the integration. Legacy source URLs are
  validated by stable resource identity: mutable title slugs are excluded, while provider host
  and workspace/repository scope remain part of the check.
- The workspace registry is the sole resolver for lifecycle, environment, and file-handling config.
  It passes the resolved `command`, `shellSetup`, and project environment to host-owned runtimes,
  which select their host's default shell immediately before spawning. Commands remain opaque;
  repository authors own their portability.
- Task and terminal providers retain stable identity and runtime capabilities, not mutable launch
  settings. `TaskSessionLaunchContextResolver` reads task, project, host, and workspace-registry
  state immediately before a process starts; task-bound providers receive its zero-argument source.
- Git/GitHub and placement previews must use the same portable resolvers as execution.
- Placement obtains the owning host's structured home path and optional `PathProfile` from the files
  runtime. It must not normalize SSH paths with the desktop's `node:path` dialect or desktop home.
  Older workspace servers may omit the profile only for the negotiated remote-POSIX fallback.

## Deferred And Deliberate Legacy Behavior

- The desktop `shareableProjectSettingsJson` column remains temporarily as a migration source and
  completion-marker carrier. Retiring that column is deferred to a future migration-train step;
  current production reads and writes must not treat it as an active settings owner.
- Historical desktop/project `shellSetup` values are deliberately dropped. They are not imported
  into host-local personal config. Current `shellSetup` comes only from `.emdash.json` or the host
  settings JSON chain above.
