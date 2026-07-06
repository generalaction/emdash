import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecResult, IExecutionContext } from '@main/core/execution-context/types';
import { getProjectSessionLeafIds } from '@main/core/tasks/session-targets';
import { makePtySessionId } from '@shared/core/pty/ptySessionId';
import { createLifecycleScriptTerminalId } from '@shared/core/terminals/terminals';
import { reconcileProjectTmuxSessions } from './tmux-reconcile';
import { makeTmuxSessionName } from './tmux-session-name';

vi.mock('@main/core/tasks/session-targets', () => ({
  getProjectSessionLeafIds: vi.fn(),
}));

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

/** Lists the given sessions; every session reports one pane (4242) + one child (9999). */
function reconcileHandler(sessions: string[]): ExecHandler {
  return (command, args) => {
    if (command === 'tmux' && args[0] === 'list-sessions') {
      return { stdout: `${sessions.join('\n')}\n`, stderr: '' };
    }
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

describe('reconcileProjectTmuxSessions', () => {
  const projectId = 'projA';
  const liveConversation = makeTmuxSessionName(makePtySessionId(projectId, 't1', 'conv-live'));
  const liveTerminal = makeTmuxSessionName(makePtySessionId(projectId, 't1', 'term-live'));
  const deadConversation = makeTmuxSessionName(makePtySessionId(projectId, 't1', 'conv-dead'));
  const lifecycleSession = makeTmuxSessionName(
    makePtySessionId(projectId, 'ws1', createLifecycleScriptTerminalId('run'))
  );
  const otherProjectSession = makeTmuxSessionName(makePtySessionId('projB', 't1', 'conv-x'));
  const unparseableSession = 'emdash-not*base64url';

  it('reaps only this project orphans, preserving live, lifecycle and foreign sessions', async () => {
    vi.mocked(getProjectSessionLeafIds).mockResolvedValue({
      conversationIds: ['conv-live'],
      terminalIds: ['term-live'],
    });
    const { ctx, calls } = makeCtx(
      reconcileHandler([
        liveConversation,
        liveTerminal,
        deadConversation,
        lifecycleSession,
        otherProjectSession,
        unparseableSession,
      ])
    );

    await reconcileProjectTmuxSessions(ctx, projectId);

    expect(killSessionTargets(calls)).toEqual([deadConversation]);
  });

  it('does no DB lookup or kills when the host has no emdash sessions', async () => {
    const { ctx, calls } = makeCtx(() => ({ stdout: '', stderr: '' }));

    await reconcileProjectTmuxSessions(ctx, projectId);

    expect(getProjectSessionLeafIds).not.toHaveBeenCalled();
    expect(killSessionTargets(calls)).toEqual([]);
  });

  it('does no DB lookup when every listed session belongs to another project', async () => {
    const { ctx, calls } = makeCtx(reconcileHandler([otherProjectSession, unparseableSession]));

    await reconcileProjectTmuxSessions(ctx, projectId);

    expect(getProjectSessionLeafIds).not.toHaveBeenCalled();
    expect(killSessionTargets(calls)).toEqual([]);
  });

  it('reaps nothing when every session is still wanted', async () => {
    vi.mocked(getProjectSessionLeafIds).mockResolvedValue({
      conversationIds: ['conv-live'],
      terminalIds: ['term-live'],
    });
    const { ctx, calls } = makeCtx(reconcileHandler([liveConversation, liveTerminal]));

    await reconcileProjectTmuxSessions(ctx, projectId);

    expect(killSessionTargets(calls)).toEqual([]);
  });
});
