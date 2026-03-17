# Main Process

## Primary Areas

- Worktrees and lifecycle:
  - `src/main/services/WorktreeService.ts`
  - `src/main/services/WorktreePoolService.ts`
  - `src/main/services/TaskLifecycleService.ts`
  - `src/main/services/LifecycleScriptsService.ts`
  - `src/main/services/ProjectPrep.ts`
- PTY and provider runtime:
  - `src/main/services/ptyManager.ts`
  - `src/main/services/ptyIpc.ts`
  - `src/main/services/ConnectionsService.ts`
  - `src/main/services/AgentEventService.ts`
  - `src/main/services/ClaudeHookService.ts`
  - `src/main/services/OpenCodeHookService.ts`
  - `src/main/services/CodexSessionService.ts`
  - `src/main/services/PlainService.ts`
- Integrations:
  - `src/main/services/GitHubService.ts`
  - `src/main/services/GitLabService.ts`
  - `src/main/services/ForgejoService.ts`
  - `src/main/services/LinearService.ts`
  - `src/main/services/JiraService.ts`
  - `src/main/services/PrGenerationService.ts`
- Platform/data:
  - `src/main/services/DatabaseService.ts`
  - `src/main/services/RepositoryManager.ts`
  - `src/main/services/ProjectSettingsService.ts`
  - `src/main/services/AutoUpdateService.ts`
  - `src/main/services/ChangelogService.ts`
  - `src/main/services/browserViewService.ts`
  - `src/main/services/hostPreviewService.ts`
- Remote development:
  - `src/main/services/RemotePtyService.ts`
  - `src/main/services/RemoteGitService.ts`
  - `src/main/services/ssh/`
- Skills and MCP:
  - `src/main/services/SkillsService.ts`
  - `src/main/services/McpService.ts`

## IPC Structure

- Main IPC files live in `src/main/ipc/`.
- Some handler files are colocated in `src/main/services/`, including `worktreeIpc.ts`, `ptyIpc.ts`, `updateIpc.ts`, `lifecycleIpc.ts`, `planLockIpc.ts`, and `fsIpc.ts`.
- There is also an RPC router in `src/shared/ipc/rpc` used for `db`, `appSettings`, and `changelog`.

## When Editing Here

- Check `agents/conventions/ipc.md` for handler contract and typing rules.
- Check `agents/risky-areas/pty.md` before touching PTY or provider spawn behavior.
- Check `agents/risky-areas/database.md` before changing persistence or migrations.
