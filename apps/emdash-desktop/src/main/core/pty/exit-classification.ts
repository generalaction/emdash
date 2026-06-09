import type { PtyExitInfo } from './pty';

export function isUnexpectedPtyExit({ exitCode, signal }: PtyExitInfo): boolean {
  return exitCode !== 0 || signal !== undefined;
}
