export {
  EXIT_CODE_MEANINGS,
  getExitCodeMeaning,
  normalizeSignal,
  SIGNAL_BY_NUMBER,
  type PtySignal,
} from './exit-signals';
export { isUnexpectedPtyExit } from './exit-classification';
export {
  logLocalPtySpawnWarnings,
  resolveLocalPtySpawn,
  type LocalPtySpawnWarning,
  type PtyCommandSpec,
  type PtySpawnIntent,
  type ResolvedLocalPtySpawn,
  type ResolvedPtyShellProfile,
} from './local-spawn';
export { PosixPtyTerminator } from './posix-pty-terminator';
export {
  collectDescendantPids,
  collectDescendantProcesses,
  collectLocalProcessInfosByPidAsync,
  collectLocalProcessTreeAsync,
  parsePidPpidPairs,
  parseProcessTable,
  type PidPpidPair,
  type ProcessInfo,
  type ProcessTreeSnapshot,
} from './process-tree';
export { PtyRegistry } from './pty-registry';
export type { PtyRegistryOptions } from './pty-registry';
export { PtySession } from './pty-session';
export type { PtySessionOptions } from './pty-session';
export {
  buildTmuxShellLine,
  killTmuxSession,
  listTmuxSessions,
  type TmuxSessionInventoryEntry,
} from './tmux-commands';
export {
  decodeLegacyTmuxSessionName,
  LEGACY_TMUX_SESSION_PREFIX,
  makeLegacyTmuxSessionName,
  makeTmuxSessionName,
  TMUX_IDENTITY_OPTION,
} from './tmux-identity';
export {
  findTmuxSessionNamesByIdentity,
  listTmuxSessionActivity,
  parseTmuxSessionActivity,
  resolveTmuxSession,
  tmuxIdentityActivityKey,
  type ResolvedTmuxSession,
} from './tmux';
export { buildTerminalEnv } from './terminal-env';
export type { PtyDimensions, PtyExitInfo, PtyProcess, PtySpawner, PtySpawnSpec } from './types';
