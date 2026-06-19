import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecResult, IExecutionContext } from '@main/core/execution-context/types';
import { makePtySessionId } from '@shared/core/pty/ptySessionId';
import { killTmuxSessionTree, listEmdashTmuxSessions } from './tmux-reaper';
import { makeTmuxSessionName } from './tmux-session-name';

type ExecCall = { command: string; args: string[] };
type ExecHandler = (command: string, args: string[]) => ExecResult;

function makeCtx(handler: ExecHandler): { ctx: IExecutionContext; calls: ExecCall[] } {
  const calls: ExecCall[] = [];
  const ctx = {
    root: undefined,
    supportsLocalSpawn: false,
    exec: vi.fn(async (command: string, args: string[] = []) => {
      calls.push({ command, args });
      return handler(command, args);
    }),
    execStreaming: vi.fn(),
    dispose: vi.fn(),
  } as unknown as IExecutionContext;
  return { ctx, calls };
}

/** Handler with one pane pid (4242) owning one detached child (9999). */
function treeHandler(): ExecHandler {
  return (command, args) => {
    if (command === 'tmux' && args[0] === 'list-panes') return { stdout: '4242\n', stderr: '' };
    if (command === 'ps') return { stdout: '4242 1\n9999 4242\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
}

function killSessionTargets(calls: ExecCall[]): string[] {
  return calls
    .filter((c) => c.command === 'tmux' && c.args[0] === 'kill-session')
    .map((c) => c.args[2]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listEmdashTmuxSessions', () => {
  it('returns only emdash-prefixed session names', async () => {
    const { ctx } = makeCtx((command, args) =>
      command === 'tmux' && args[0] === 'list-sessions'
        ? { stdout: 'emdash-a\nother-session\nemdash-b\n', stderr: '' }
        : { stdout: '', stderr: '' }
    );
    expect(await listEmdashTmuxSessions(ctx)).toEqual(['emdash-a', 'emdash-b']);
  });

  it('returns [] when tmux has no server / errors out', async () => {
    const ctx = {
      exec: vi.fn(async () => {
        throw new Error('no server running');
      }),
    } as unknown as IExecutionContext;
    expect(await listEmdashTmuxSessions(ctx)).toEqual([]);
  });
});

describe('killTmuxSessionTree', () => {
  it('snapshots the pane tree before kill-session, then SIGKILLs the escaped descendants', async () => {
    const name = makeTmuxSessionName(makePtySessionId('p', 't', 'c'));
    const { ctx, calls } = makeCtx(treeHandler());

    await killTmuxSessionTree(ctx, name);

    const seq = calls.map((c) => `${c.command} ${c.args[0] ?? ''}`.trim());
    const killIdx = seq.indexOf('tmux kill-session');
    expect(seq.indexOf('tmux list-panes')).toBeLessThan(killIdx);
    expect(seq.indexOf('ps -A')).toBeLessThan(killIdx);

    const reap = calls.find((c) => c.command === 'sh');
    expect(reap).toBeDefined();
    // Only the escaped descendant is reaped — the pane pid (4242) is left to
    // kill-session, since it is likely dead and its pid may have been recycled.
    expect(reap?.args[1]).toContain('9999');
    expect(reap?.args[1]).not.toContain('4242');
    // SIGKILL only — no pointless ungraced SIGTERM.
    expect(reap?.args[1]).toContain('kill -KILL');
    expect(reap?.args[1]).not.toContain('-TERM');
  });

  it('does not reap when ps is unavailable (cannot identify escaped descendants)', async () => {
    const { ctx, calls } = makeCtx((command, args) => {
      if (command === 'tmux' && args[0] === 'list-panes') return { stdout: '4242\n', stderr: '' };
      if (command === 'ps') throw new Error('ps: command not found');
      return { stdout: '', stderr: '' };
    });

    await killTmuxSessionTree(ctx, 'emdash-x');

    expect(killSessionTargets(calls)).toEqual(['emdash-x']);
    expect(calls.find((c) => c.command === 'sh')).toBeUndefined();
  });

  it('still kills the session but skips reaping when there are no panes', async () => {
    const { ctx, calls } = makeCtx((command, args) =>
      command === 'tmux' && args[0] === 'list-panes'
        ? { stdout: '\n', stderr: '' }
        : { stdout: '', stderr: '' }
    );

    await killTmuxSessionTree(ctx, 'emdash-x');

    expect(killSessionTargets(calls)).toEqual(['emdash-x']);
    expect(calls.find((c) => c.command === 'sh')).toBeUndefined();
  });

  it('never throws when the remote commands fail', async () => {
    const ctx = {
      exec: vi.fn(async () => {
        throw new Error('connection dropped');
      }),
    } as unknown as IExecutionContext;
    await expect(killTmuxSessionTree(ctx, 'emdash-x')).resolves.toBeUndefined();
  });
});
