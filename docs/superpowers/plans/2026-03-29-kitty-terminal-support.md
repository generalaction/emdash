# Kitty Terminal "Open In" Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Kitty terminal emulator to the "Open in" top bar menu with local and remote SSH support on Linux.

**Architecture:** Register Kitty in the shared app registry (`openInApps.ts`), add a remote SSH handler in the main-process IPC layer (`appIpc.ts`) following the Ghostty pattern, and download the official Kitty icon. All renderer/settings code auto-discovers new entries.

**Tech Stack:** TypeScript, Electron IPC, Vitest, child_process

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/assets/images/kitty.png` | Create | Kitty icon asset (128x128 from official repo) |
| `src/shared/openInApps.ts` | Modify | Add `kitty` to `ICON_PATHS` and `OPEN_IN_APPS` |
| `src/main/ipc/appIpc.ts` | Modify | Add Kitty remote SSH handler block |
| `src/test/shared/openInApps.test.ts` | Modify | Add `'kitty'` to remote-support assertion |

---

### Task 1: Add Kitty icon asset

**Files:**
- Create: `src/assets/images/kitty.png`

- [ ] **Step 1: Download Kitty icon from official repo**

```bash
curl -L -o src/assets/images/kitty.png \
  "https://raw.githubusercontent.com/kovidgoyal/kitty/master/logo/kitty-128.png"
```

- [ ] **Step 2: Verify the file exists and is a valid PNG**

Run: `file src/assets/images/kitty.png`
Expected: output contains `PNG image data`

- [ ] **Step 3: Commit**

```bash
git add src/assets/images/kitty.png
git commit -m "feat: add Kitty terminal icon asset"
```

---

### Task 2: Register Kitty in the app registry (TDD)

**Files:**
- Modify: `src/test/shared/openInApps.test.ts`
- Modify: `src/shared/openInApps.ts`

- [ ] **Step 1: Write the failing test — Kitty appears in remote-supported apps**

In `src/test/shared/openInApps.test.ts`, update the existing remote-support assertion at line 25 to include `'kitty'`:

```typescript
    expect(remoteAppIds).toEqual(
      expect.arrayContaining(['cursor', 'vscode', 'terminal', 'warp', 'iterm2', 'ghostty', 'kitty'])
    );
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/test/shared/openInApps.test.ts`
Expected: FAIL — `'kitty'` not found in remote app IDs

- [ ] **Step 3: Add Kitty to ICON_PATHS in openInApps.ts**

In `src/shared/openInApps.ts`, add `kitty` to the `ICON_PATHS` object (after the `kiro` entry at line 44):

```typescript
  kiro: 'kiro.png',
  kitty: 'kitty.png',
  windsurf: 'windsurf.svg',
```

- [ ] **Step 4: Add Kitty entry to OPEN_IN_APPS array**

In `src/shared/openInApps.ts`, add a new entry after the `foot` entry (after line 266, before the `zed` entry):

```typescript
  {
    id: 'kitty',
    label: 'Kitty',
    iconPath: ICON_PATHS.kitty,
    supportsRemote: true,
    platforms: {
      linux: {
        openCommands: ['kitty --directory={{path}}'],
        checkCommands: ['kitty'],
      },
    },
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run src/test/shared/openInApps.test.ts`
Expected: PASS — all 3 tests green

- [ ] **Step 6: Commit**

```bash
git add src/shared/openInApps.ts src/test/shared/openInApps.test.ts
git commit -m "feat: register Kitty in open-in app registry with remote support"
```

---

### Task 3: Add Kitty remote SSH handler

**Files:**
- Modify: `src/main/ipc/appIpc.ts`

- [ ] **Step 1: Add the Kitty remote SSH handler block**

In `src/main/ipc/appIpc.ts`, add a new `else if` block after the Ghostty handler (after line 440, before the `} else if (appConfig.supportsRemote)` fallback):

```typescript
            } else if (appId === 'kitty') {
              const kittyExecArgs = buildGhosttyRemoteExecArgs({
                host: connection.host,
                username: connection.username,
                port: connection.port,
                targetPath: target,
              });

              await execFileCommand('kitty', ['-e', ...kittyExecArgs]);
              return { success: true };
            }
```

This reuses `buildGhosttyRemoteExecArgs` because Kitty accepts the same `-e` flag format as Ghostty — both pass argv tokens directly to `execFile` without shell interpretation.

- [ ] **Step 2: Run type-check to verify no type errors**

Run: `pnpm run type-check`
Expected: no errors

- [ ] **Step 3: Run existing appIpc tests to verify no regressions**

Run: `pnpm exec vitest run src/test/main/appIpc.openIn.test.ts`
Expected: PASS — all existing tests still green

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/appIpc.ts
git commit -m "feat: add Kitty remote SSH handler in open-in IPC"
```

---

### Task 4: Full validation

- [ ] **Step 1: Run formatter**

Run: `pnpm run format`

- [ ] **Step 2: Run linter**

Run: `pnpm run lint`

- [ ] **Step 3: Run type-check**

Run: `pnpm run type-check`

- [ ] **Step 4: Run full test suite**

Run: `pnpm exec vitest run`
Expected: all tests pass

- [ ] **Step 5: Commit any formatting fixes if needed**

```bash
git add -A
git commit -m "chore: format and lint fixes for Kitty support"
```

(Skip this step if there are no changes after formatting/linting.)
