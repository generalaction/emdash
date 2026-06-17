import { log } from '@main/lib/logger';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { quoteShellArg } from '@main/utils/shellEscape';
import type { MultiplexerBackend } from './types';

const BOO_SESSION_PREFIX = 'emdash-';

export const booBackend: MultiplexerBackend = {
  id: 'boo',
  makeSessionName(sessionId: string): string {
    return `${BOO_SESSION_PREFIX}${Buffer.from(sessionId, 'utf8').toString('base64url')}`;
  },
  buildAttachShellLine(sessionName: string, commandLine: string): string {
    const name = quoteShellArg(sessionName);
    const cmd = quoteShellArg(commandLine);
    // Create detached if missing (ignore "already exists"), then attach. `exec` makes the
    // pty become the boo client. boo's VT is UTF-8 native, so no `-u`-style flag is needed.
    // Args are quoted with quoteShellArg (single-quote wrapping) for security — prevents
    // variable expansion, command substitution, and globbing. The outer `/bin/sh -c` forces
    // POSIX semantics regardless of the user's login shell.
    const script = `boo new ${name} -d -- /bin/sh -c ${cmd} 2>/dev/null; exec boo attach ${name}`;
    return `/bin/sh -c ${quoteShellArg(script)}`;
  },
  async killSession(ctx: IExecutionContext, sessionName: string): Promise<void> {
    try {
      await ctx.exec('boo', ['kill', sessionName]);
    } catch (err) {
      log.debug('booBackend.killSession: session not found or already dead', {
        sessionName,
        error: String(err),
      });
    }
  },
};
