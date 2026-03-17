import { useCallback, useEffect, useMemo } from 'react';
import { makePtySessionId } from '@shared/ptySessionId';
import type { Terminal } from '@shared/terminals';
import { getPaneContainer } from '@renderer/core/pty/pane-sizing-context';
import { measureDimensions } from '@renderer/core/pty/pty-dimensions';
import { usePtySession } from '@renderer/core/pty/pty-session-context';
import { useTerminalsContext } from '@renderer/features/terminals/terminal-data-provider';

/** Measure the terminals pane using a typical monospace cell size (13px font). */
function getTerminalsPaneSize() {
  const container = getPaneContainer('terminals');
  return container ? (measureDimensions(container, 8, 16) ?? undefined) : undefined;
}

/** Compute the lowest available "Terminal N" name given existing terminals. */
export function nextTerminalName(terminals: Terminal[]): string {
  const taken = new Set(
    terminals
      .map((t) => /^Terminal (\d+)$/.exec(t.name)?.[1])
      .filter(Boolean)
      .map(Number)
  );
  let n = 1;
  while (taken.has(n)) n++;
  return `Terminal ${n}`;
}

export function useTerminals({ taskId, projectId }: { projectId: string; taskId: string }) {
  const {
    terminalsByTaskId,
    deleteTerminal: generalDeleteTerminal,
    createTerminal: generalCreateTerminal,
  } = useTerminalsContext();

  const { registerSession, unregisterSession } = usePtySession();

  const terminals = useMemo(() => terminalsByTaskId[taskId] ?? [], [terminalsByTaskId, taskId]);

  const createTerminal = useCallback(async () => {
    const id = crypto.randomUUID();
    const sessionId = makePtySessionId(projectId, taskId, id);
    const name = nextTerminalName(terminals);

    registerSession(sessionId);

    const terminal = await generalCreateTerminal({
      id,
      projectId,
      taskId,
      name,
      initialSize: getTerminalsPaneSize(),
    });

    return terminal;
  }, [generalCreateTerminal, projectId, registerSession, taskId, terminals]);

  const removeTerminal = useCallback(
    (terminalId: string) => {
      unregisterSession(makePtySessionId(projectId, taskId, terminalId));
      generalDeleteTerminal({ projectId, taskId, terminalId });
    },
    [generalDeleteTerminal, projectId, taskId, unregisterSession]
  );

  // Register FrontendPty listeners for all existing terminals on mount.
  // registerSession() is idempotent — no RPC needed since the PTY is already
  // running on the backend from the original createTerminal call.
  useEffect(() => {
    if (terminals.length === 0) return;
    for (const terminal of terminals) {
      registerSession(makePtySessionId(projectId, taskId, terminal.id));
    }
  }, [terminals, projectId, registerSession, taskId]);

  return { terminals, createTerminal, removeTerminal };
}
