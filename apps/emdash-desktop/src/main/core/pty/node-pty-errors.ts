import type { IPty } from 'node-pty';
import { log } from '@main/lib/logger';

type NodePtyWithErrorEvents = IPty & {
  on?: (event: 'error', handler: (error: NodeJS.ErrnoException) => void) => void;
};

export function suppressExpectedNodePtyErrors(
  proc: IPty,
  platform: NodeJS.Platform = process.platform
): void {
  if (platform !== 'win32') return;

  (proc as NodePtyWithErrorEvents).on?.('error', (error) => {
    if (error.code === 'EPIPE' || error.code === 'EIO') return;
    log.warn('node-pty: unexpected PTY error', {
      code: error.code,
      message: error.message,
    });
  });
}
