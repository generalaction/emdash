/**
 * Cross-platform abstraction for behavior that genuinely differs between
 * Windows and POSIX. Keep this surface small — only add to it when a divergence
 * shows up at multiple call sites. Anything that can be expressed via Node's
 * stdlib alone (path.posix vs path.win32, fs.realpath, etc.) does not belong here.
 */
export interface PlatformAdapter {
  /** Process platform identifier mirroring `process.platform`. */
  readonly platform: NodeJS.Platform;
  readonly isWindows: boolean;

  /**
   * Extra PATH directories to prepend when probing or launching CLI tools.
   * On Windows this includes npm global bin, common IDE install dirs, etc.
   * Returns an empty array on POSIX (the inherited PATH is already correct).
   */
  augmentedPathEntries(): readonly string[];

  /**
   * Returns an environment object with augmented PATH applied. Caller passes
   * in their own env (typically `process.env`); this never mutates it.
   */
  augmentEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv;

  /**
   * Compare two filesystem paths for equivalence under the current platform's
   * case rules. Used for root-escape checks where a case mismatch on
   * NTFS/APFS-default would otherwise reject a valid path.
   */
  pathsEqual(a: string, b: string): boolean;

  /**
   * Best-effort cross-platform basename — splits on both `/` and `\`. Useful
   * in renderer code that receives paths from either side.
   */
  basenameAny(p: string): string;

  /**
   * Preferred interactive shell executable for an interactive PTY pane.
   * Returns null to let the spawn-platform layer pick its default. On Windows,
   * resolves `pwsh.exe` if installed, falling back to `ComSpec`/cmd.exe.
   */
  preferredInteractiveShell(env: NodeJS.ProcessEnv): string | null;

  /** Hook command flavor used when emitting per-provider shim scripts. */
  readonly hookCommandKind: 'sh' | 'powershell';
}
