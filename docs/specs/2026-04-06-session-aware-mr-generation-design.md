# Session-Aware MR Generation

## Problem

When creating a Merge Request, emdash generates the PR title, description, commit message, and branch name without any awareness of the conversation session where the work was done. The current flow spawns Claude in cold `-p` mode with only git diff stats and commit messages as context. This produces generic, low-quality outputs that don't reflect what was actually built or why.

Meanwhile, the Claude session that did the work has the full picture: the original task, the reasoning, the trade-offs, and the final state. That context should drive the MR metadata.

Additionally, branches are named at creation time based on the initial prompt or a timestamp fallback (`orch/<base36-timestamp>`). By the time the work is done, the branch name often no longer reflects the actual feature. There is no mechanism to rename it.

## Design

### Core change

Replace the cold `claude -p` invocation in `PrGenerationService` with a session-aware call:

```
claude -r <sessionId> --fork-session -p "<prompt>" --output-format json --model sonnet
```

This forks the active session (read-only, no side effects on the original) and asks Sonnet to generate all four MR artifacts in a single call:

1. **PR title** (conventional commit format, max 72 chars)
2. **PR description** (structured markdown)
3. **Commit message** (for the final commit before MR creation)
4. **Branch name suggestion** (slug-style, following project conventions)

### Session ID resolution

The session ID is resolved from the ptyManager session map:

1. `git:generate-pr-content` IPC handler already looks up the task via `databaseService.getTaskByPath(taskPath)` to get `task.agentId`
2. Derive the ptyId: `makePtyId(task.agentId, 'main', task.id)`
3. Look up the session UUID from `getStoredExactResumeArgs()` or directly from the session map via `getNormalizedSessionEntry()`
4. If no session ID is found (non-Claude provider, or session map miss), fall back to current cold `-p` behavior without `--resume` or `--fork-session`

No database schema changes required. No fallback to `~/.claude/projects/` discovery.

### Prompt design

The prompt sent to the forked session includes:

- Git diff stats (existing, truncated to 2000 chars)
- Commit messages on the branch (existing)
- Current branch name (new)
- Instruction to return JSON with `title`, `description`, `commitMessage`, and `branchName` fields
- Instruction that `branchName` should follow project conventions (conventional commit prefix as directory, slug-style, max 64 chars)

The prompt explicitly tells Claude it has the session context and should use it to understand what was built and why, rather than relying solely on the diff.

### Branch rename flow

When the generated `branchName` differs from the current branch:

1. The `generatePrContent` IPC response includes both `branchName` (suggested) and `currentBranch`
2. The PR creation dialog shows the suggestion inline: `Branch: orch/abc123 -> feat/add-user-auth-3f2 [Accept] [Dismiss]`
3. If the user accepts:
   a. Rename locally: `git branch -m <old> <new>`
   b. Push new branch: `git push --set-upstream origin <new>`
   c. Delete old remote branch: `git push origin --delete <old>`
   d. Continue with MR creation using the new branch name as `head`
4. If the user dismisses, proceed with the current branch name unchanged

The rename happens before the final commit and MR creation so the MR is created against the correct branch name.

### Commit message flow

The generated `commitMessage` replaces the current logic in `useCreatePR` where the PR title is reused as the commit message (`useCreatePR.tsx:88`). The session-aware commit message can be more descriptive than the PR title since it serves a different purpose (git log vs. MR list).

### Timing

Session-aware generation only happens at MR creation time. Intermediate commits during development keep their current behavior (explicit message or default `'chore: apply task changes'`). This avoids slowing down the development loop with Claude spawns on every commit.

## Files to modify

### `src/main/services/PrGenerationService.ts`

- Extend `generatePrContent()` signature to accept an optional `sessionId` parameter
- Extend `GeneratedPrContent` interface to include `branchName` and `commitMessage`
- In `spawnProvider()` for Claude: when `sessionId` is provided, use `-r <sessionId> --fork-session` args and add `--model sonnet`
- Update `buildPrGenerationPrompt()` to include current branch name and request all four fields
- Update `parseProviderResponse()` to extract `branchName` and `commitMessage` from JSON

### `src/main/ipc/gitIpc.ts`

- In `git:generate-pr-content` handler: resolve session ID from ptyManager session map using task's agentId and taskId
- Pass session ID through to `prGenerationService.generatePrContent()`
- Include `currentBranch` in the response so the renderer can compare

### `src/main/services/ptyManager.ts`

- Export a function to look up a session UUID by ptyId (thin wrapper around existing `getNormalizedSessionEntry` + `loadSessionMap`). Currently these are module-private; one needs to be exposed.

### `src/renderer/types/electron-api.d.ts`

- Update `generatePrContent` return type to include `branchName`, `commitMessage`, and `currentBranch`

### `src/main/preload.ts`

- No changes needed — the existing IPC bridge passes args/results through transparently

### `src/renderer/components/FileChangesPanel.tsx`

- This is the component that calls `createPR()` via `handlePrAction()` (line ~657)
- Before calling `createPR()`, trigger the PR content generation and show a branch rename confirmation inline if the suggested branch name differs from the current one
- The confirmation UI (accept/dismiss) can be a small inline element near the existing PR action button area

### `src/renderer/hooks/useCreatePR.tsx`

(already listed above — adding UI detail)

- Split the flow: first call `generatePrContent` to get all four fields, then show results to user
- If branch rename is accepted, execute rename commands (local rename, push new, delete old remote) before proceeding with commit+push+MR creation
- The `createPR` function gains an optional `branchRename` parameter: `{ from: string; to: string } | null`

## Non-goals

- Changing intermediate commit message generation (stays as-is)
- Falling back to `~/.claude/projects/` session discovery
- Schema changes to store session IDs on task records
- Supporting non-Claude providers with session context (they get current cold behavior)

## Risks

- **`--fork-session` flag availability**: needs to be verified on the minimum supported Claude CLI version. If unavailable, the feature degrades to current cold behavior.
- **Session expiry / staleness**: if the session UUID references a session that Claude CLI can't find, the invocation may fail. The retry logic (2 attempts) in `generateWithProvider` handles this — on failure it falls back to heuristic generation.
- **Branch rename race condition**: if the old remote branch has a PR already open, deleting the old remote branch could affect it. This is mitigated by the user confirmation step — the dialog should warn if a PR already exists on the current branch.
- **Latency**: forking a session may be slower than a cold `-p` call. Acceptable since this only happens once at MR creation time, and using Sonnet (not Opus) keeps it fast.
