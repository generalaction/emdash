import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecResult, IExecutionContext } from '@main/core/execution-context/types';
import { makePtySessionId } from '@shared/core/pty/ptySessionId';
import {
  killTmuxSessionsByPtyIds,
  killTmuxSessionTree,
  listEmdashTmuxSessions,
  TmuxSessionDiscoveryError,
} from './tmux-reaper';
import {
  makeLegacyTmuxSessionName,
  TMUX_LEAF_ID_OPTION,
  TMUX_PROJECT_ID_OPTION,
  TMUX_TASK_ID_OPTION,
} from './tmux-session-name';

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
  it('returns only emdash-prefixed sessions with metadata from one list call', async () => {
    const { ctx } = makeCtx((command, args) =>
      command === 'tmux' && args[0] === 'list-sessions'
        ? {
            stdout:
              'emdash-work-a\tproject-a\ttask-a\tleaf-a\n' +
              'other-session\tforeign\ttask\tleaf\n' +
              'emdash-work-b\tproject-b\ttask-b\tleaf-b\n',
            stderr: '',
          }
        : { stdout: '', stderr: '' }
    );
    expect(await listEmdashTmuxSessions(ctx)).toEqual([
      {
        name: 'emdash-work-a',
        identity: { projectId: 'project-a', taskId: 'task-a', leafId: 'leaf-a' },
      },
      {
        name: 'emdash-work-b',
        identity: { projectId: 'project-b', taskId: 'task-b', leafId: 'leaf-b' },
      },
    ]);
    expect(ctx.exec).toHaveBeenCalledTimes(1);
    expect(ctx.exec).toHaveBeenCalledWith('tmux', [
      'list-sessions',
      '-F',
      `#{session_name}\t#{${TMUX_PROJECT_ID_OPTION}}\t#{${TMUX_TASK_ID_OPTION}}\t#{${TMUX_LEAF_ID_OPTION}}`,
    ]);
  });

  it('decodes sessions created by versions that stored identity in the name', async () => {
    const sessionId = makePtySessionId('legacy-project', 'legacy-task', 'legacy-leaf');
    const name = makeLegacyTmuxSessionName(sessionId);
    const { ctx } = makeCtx((command, args) =>
      command === 'tmux' && args[0] === 'list-sessions'
        ? { stdout: `${name}\t\t\t\n`, stderr: '' }
        : { stdout: '', stderr: '' }
    );

    expect(await listEmdashTmuxSessions(ctx)).toEqual([
      {
        name,
        identity: {
          projectId: 'legacy-project',
          taskId: 'legacy-task',
          leafId: 'legacy-leaf',
        },
      },
    ]);
    expect(ctx.exec).toHaveBeenCalledTimes(1);
  });

  it('falls back to show-options when old tmux cannot expand user options in formats', async () => {
    const { ctx, calls } = makeCtx((command, args) => {
      if (command === 'tmux' && args[0] === 'list-sessions' && args[2] !== '#{session_name}') {
        throw new Error('unknown format');
      }
      if (command === 'tmux' && args[0] === 'list-sessions') {
        return { stdout: 'emdash-work-token\n', stderr: '' };
      }
      if (command === 'tmux' && args[0] === 'show-options') {
        return {
          stdout: `${TMUX_PROJECT_ID_OPTION} project-1\n${TMUX_TASK_ID_OPTION} task-1\n${TMUX_LEAF_ID_OPTION} leaf-1\n`,
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    });

    expect(await listEmdashTmuxSessions(ctx)).toEqual([
      {
        name: 'emdash-work-token',
        identity: { projectId: 'project-1', taskId: 'task-1', leafId: 'leaf-1' },
      },
    ]);
    expect(calls.map(({ args }) => args[0])).toEqual([
      'list-sessions',
      'list-sessions',
      'show-options',
    ]);
  });

  it('falls back to names when an old tmux returns success with empty rich output', async () => {
    const { ctx, calls } = makeCtx((command, args) => {
      if (command === 'tmux' && args[0] === 'list-sessions' && args[2] !== '#{session_name}') {
        return { stdout: '', stderr: '' };
      }
      if (command === 'tmux' && args[0] === 'list-sessions') {
        return { stdout: 'emdash-work-token\n', stderr: '' };
      }
      if (command === 'tmux' && args[0] === 'show-options') {
        return {
          stdout: `${TMUX_PROJECT_ID_OPTION} project-1\n${TMUX_TASK_ID_OPTION} task-1\n${TMUX_LEAF_ID_OPTION} leaf-1\n`,
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    });

    expect(await listEmdashTmuxSessions(ctx)).toEqual([
      {
        name: 'emdash-work-token',
        identity: { projectId: 'project-1', taskId: 'task-1', leafId: 'leaf-1' },
      },
    ]);
    expect(calls.map(({ args }) => args[0])).toEqual([
      'list-sessions',
      'list-sessions',
      'show-options',
    ]);
  });

  it('falls back to names and show-options when old tmux returns literal metadata placeholders', async () => {
    const { ctx, calls } = makeCtx((command, args) => {
      if (command === 'tmux' && args[0] === 'list-sessions' && args[2] !== '#{session_name}') {
        return {
          stdout: `emdash-work-token\t#{${TMUX_PROJECT_ID_OPTION}}\t#{${TMUX_TASK_ID_OPTION}}\t#{${TMUX_LEAF_ID_OPTION}}\n`,
          stderr: '',
        };
      }
      if (command === 'tmux' && args[0] === 'list-sessions') {
        return { stdout: 'emdash-work-token\n', stderr: '' };
      }
      if (command === 'tmux' && args[0] === 'show-options') {
        return {
          stdout: `${TMUX_PROJECT_ID_OPTION} project-1\n${TMUX_TASK_ID_OPTION} task-1\n${TMUX_LEAF_ID_OPTION} leaf-1\n`,
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    });

    expect(await listEmdashTmuxSessions(ctx)).toEqual([
      {
        name: 'emdash-work-token',
        identity: { projectId: 'project-1', taskId: 'task-1', leafId: 'leaf-1' },
      },
    ]);
    expect(calls.map(({ args }) => args[0])).toEqual([
      'list-sessions',
      'list-sessions',
      'show-options',
    ]);
  });

  it('keeps partially tagged or unrelated prefixed sessions unowned', async () => {
    const { ctx } = makeCtx((command, args) => {
      if (command === 'tmux' && args[0] === 'list-sessions') {
        return { stdout: 'emdash-unowned\tproject-1\t\tleaf-1\n', stderr: '' };
      }
      if (command === 'tmux' && args[0] === 'show-options') {
        return { stdout: `${TMUX_PROJECT_ID_OPTION} project-1\n`, stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });

    expect(await listEmdashTmuxSessions(ctx)).toEqual([{ name: 'emdash-unowned', identity: null }]);
  });

  it('returns [] when tmux has no server / errors out', async () => {
    const ctx = {
      exec: vi.fn(async () => {
        throw new Error('no server running');
      }),
    } as unknown as IExecutionContext;
    expect(await listEmdashTmuxSessions(ctx)).toEqual([]);
  });

  it('rejects when both rich and name-only discovery fail for an unknown reason', async () => {
    const ctx = {
      exec: vi.fn(async () => {
        throw Object.assign(new Error('SSH connection dropped'), {
          stderr: 'channel closed',
        });
      }),
    } as unknown as IExecutionContext;

    await expect(listEmdashTmuxSessions(ctx)).rejects.toBeInstanceOf(TmuxSessionDiscoveryError);
    expect(ctx.exec).toHaveBeenCalledTimes(2);
  });

  it('does not treat an unspecified failed-to-connect error as an absent tmux server', async () => {
    const ctx = {
      exec: vi.fn(async () => {
        throw new Error('failed to connect to server: permission denied');
      }),
    } as unknown as IExecutionContext;

    await expect(listEmdashTmuxSessions(ctx)).rejects.toBeInstanceOf(TmuxSessionDiscoveryError);
  });

  it('propagates transient show-options failures after name-only fallback', async () => {
    const { ctx } = makeCtx((command, args) => {
      if (command === 'tmux' && args[0] === 'list-sessions' && args[2] !== '#{session_name}') {
        throw new Error('unknown format');
      }
      if (command === 'tmux' && args[0] === 'list-sessions') {
        return { stdout: 'emdash-work-token\n', stderr: '' };
      }
      if (command === 'tmux' && args[0] === 'show-options') {
        throw new Error('SSH connection dropped');
      }
      return { stdout: '', stderr: '' };
    });

    await expect(listEmdashTmuxSessions(ctx)).rejects.toThrow('SSH connection dropped');
  });

  it('keeps a session unowned when it disappears before show-options', async () => {
    const { ctx } = makeCtx((command, args) => {
      if (command === 'tmux' && args[0] === 'list-sessions' && args[2] !== '#{session_name}') {
        throw new Error('unknown format');
      }
      if (command === 'tmux' && args[0] === 'list-sessions') {
        return { stdout: 'emdash-work-token\n', stderr: '' };
      }
      if (command === 'tmux' && args[0] === 'show-options') {
        throw new Error("can't find session: emdash-work-token");
      }
      return { stdout: '', stderr: '' };
    });

    expect(await listEmdashTmuxSessions(ctx)).toEqual([
      { name: 'emdash-work-token', identity: null },
    ]);
  });
});

describe('killTmuxSessionTree', () => {
  it('snapshots the pane tree before kill-session, then SIGKILLs the escaped descendants', async () => {
    const name = makeLegacyTmuxSessionName(makePtySessionId('p', 't', 'c'));
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

describe('killTmuxSessionsByPtyIds', () => {
  it('resolves friendly and legacy names by identity with one list call per batch', async () => {
    const legacyId = makePtySessionId('project-1', 'task-1', 'legacy-leaf');
    const legacyName = makeLegacyTmuxSessionName(legacyId);
    const { ctx, calls } = makeCtx((command, args) => {
      if (command === 'tmux' && args[0] === 'list-sessions') {
        return {
          stdout:
            'emdash-work-token\tproject-1\ttask-1\tfriendly-leaf\n' +
            `${legacyName}\t\t\t\n` +
            'emdash-foreign\tproject-2\ttask-2\tleaf-2\n',
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    });

    await killTmuxSessionsByPtyIds(ctx, [
      makePtySessionId('project-1', 'task-1', 'friendly-leaf'),
      legacyId,
    ]);

    expect(killSessionTargets(calls)).toEqual(['emdash-work-token', legacyName]);
    expect(calls.filter(({ args }) => args[0] === 'list-sessions')).toHaveLength(1);
  });

  it('propagates discovery failure instead of reporting cleanup success', async () => {
    const ctx = {
      exec: vi.fn(async () => {
        throw new Error('connection timed out');
      }),
    } as unknown as IExecutionContext;

    await expect(
      killTmuxSessionsByPtyIds(ctx, [makePtySessionId('project-1', 'task-1', 'leaf-1')])
    ).rejects.toBeInstanceOf(TmuxSessionDiscoveryError);
    expect(ctx.exec).not.toHaveBeenCalledWith('tmux', expect.arrayContaining(['kill-session']));
  });
});
