import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * Whether local PTYs should ask node-pty to load its bundled, up-to-date
 * ConPTY (`useConptyDll: true`) instead of the OS in-box conhost.
 *
 * The in-box ConPTY on Windows 10 (and older Windows 11 builds) does not pass
 * mouse-mode DECSETs (1000/1002/1003/1006) or the alternate-screen switch
 * through to the attached terminal, and silently drops SGR mouse reports
 * written to its input pipe. Fullscreen TUIs (opencode, claude, amp) are
 * unusable with it: no mouse clicks, no wheel scrolling, and xterm.js never
 * even learns the app entered the alternate screen. The bundled conpty.dll
 * (from the Windows Terminal project) supports full passthrough in both
 * directions.
 *
 * node-pty resolves the dll as `<dir of conpty.node>/conpty/conpty.dll` and
 * throws synchronously from spawn when it is missing, so we only opt in when
 * the dll is actually present next to the native module that will load
 * (electron-rebuild wipes build/Release; the copy step in
 * scripts/copy-conpty-dll.ts restores it).
 */
export function resolveUseConptyDll(): boolean {
  if (process.platform !== 'win32') return false;
  if (process.env.EMDASH_DISABLE_CONPTY_DLL === '1') return false;
  return conptyDllIsPresent();
}

let cachedPresence: boolean | null = null;

function conptyDllIsPresent(): boolean {
  if (cachedPresence !== null) return cachedPresence;
  try {
    const require = createRequire(import.meta.url);
    const packageRoot = path.dirname(require.resolve('node-pty/package.json'));
    cachedPresence = conptyDllPresentUnder(packageRoot);
  } catch {
    cachedPresence = false;
  }
  return cachedPresence;
}

/** Test seam: clears the memoized dll-presence check. */
export function resetConptyDllCacheForTests(): void {
  cachedPresence = null;
}

/**
 * Stop offering the bundled dll for the rest of the process — called when a
 * spawn with it failed while the in-box ConPTY worked (AV quarantine, broken
 * copy), so later spawns skip the doomed attempt.
 */
export function markConptyDllUnavailable(): void {
  cachedPresence = false;
}

/**
 * Mirrors node-pty's loadNativeModule() search order (lib/utils.ts): the
 * first directory containing conpty.node is the one that will load, and the
 * dll must sit in a `conpty/` folder next to it.
 */
export function conptyDllPresentUnder(packageRoot: string): boolean {
  const candidateDirs = [
    path.join(packageRoot, 'build', 'Release'),
    path.join(packageRoot, 'build', 'Debug'),
    path.join(packageRoot, 'prebuilds', `${process.platform}-${process.arch}`),
  ];
  for (const dir of candidateDirs) {
    if (!existsSync(path.join(dir, 'conpty.node'))) continue;
    return existsSync(path.join(dir, 'conpty', 'conpty.dll'));
  }
  return false;
}
