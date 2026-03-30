# Add Kitty Terminal to "Open In" Menu

**Date**: 2026-03-29
**Status**: Approved
**Approach**: A — Follow the Ghostty pattern exactly

## Goal

Add Kitty terminal emulator as an "Open in" option in the top bar menu, supporting both local directory opening and remote SSH workspaces. Linux first; macOS support deferred.

## Scope

- Local launch: open Kitty in the project directory
- Remote SSH launch: open Kitty with an SSH session to the remote host
- Icon in the "Open in" dropdown menu
- Auto-detection of Kitty installation

## Files to Change

### 1. `src/assets/images/kitty.png` (new file)

Download the 128x128 Kitty icon from the official repo (`kovidgoyal/kitty` on GitHub, `logo/kitty-128.png`).

### 2. `src/shared/openInApps.ts`

Add `kitty: 'kitty.png'` to `ICON_PATHS`.

Add entry to `OPEN_IN_APPS` array after the `foot` entry:

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
}
```

- `--directory` is Kitty's flag for setting the working directory.
- `checkCommands: ['kitty']` enables auto-detection via `which kitty`.
- `supportsRemote: true` enables the remote SSH handler.
- macOS platform config omitted for now; will be added in a follow-up.

The `OpenInAppId` type is auto-derived from the `as const` array, so no manual type update is needed.

### 3. `src/main/ipc/appIpc.ts`

Add a new `else if (appId === 'kitty')` block after the Ghostty remote handler (~line 440).

Pattern:
- Reuse `buildGhosttyRemoteExecArgs` to build SSH argv tokens (Kitty accepts the same `-e` flag semantics as Ghostty for executing a command).
- Launch via `execFileCommand('kitty', ['-e', ...execArgs])`.
- Linux only (single attempt, no macOS fallbacks needed yet).

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

### 4. `src/test/shared/openInApps.test.ts`

Add `'kitty'` to the `expect.arrayContaining(...)` assertion that checks remote-supported apps.

### 5. `src/main/utils/remoteOpenIn.ts` (no change needed)

`buildGhosttyRemoteExecArgs` produces generic SSH argv tokens. Kitty's `-e` flag accepts the same format. No new builder function or rename is required for this scope.

## Auto-discovered (no changes needed)

These files iterate over `OPEN_IN_APPS` dynamically and will pick up Kitty automatically:

- `src/renderer/hooks/useOpenInApps.ts` — icon loading, availability checking
- `src/renderer/components/titlebar/OpenInMenu.tsx` — dropdown rendering
- `src/renderer/components/HiddenToolsSettingsCard.tsx` — settings UI
- `src/main/settings.ts` — validation via `isValidOpenInAppId()`
- `src/main/services/TerminalConfigParser.ts` — Kitty theme parsing already implemented

## Out of Scope

- macOS support (deferred)
- Renaming `buildGhosttyRemoteExecArgs` to a generic name (can be done later if more terminals reuse it)
- Kitty-specific remote SSH features (e.g., kitten ssh)
