import { useCallback, useEffect, useMemo, useState } from 'react';
import { makePtySessionId } from '@shared/ptySessionId';
import { createScriptTerminalId, type Terminal } from '@shared/terminals';
import { ProjectSettings } from '@main/core/projects/settings/schema';
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

export function useTerminals({
  taskId,
  projectId,
  projectSettings,
}: {
  projectId: string;
  taskId: string;
  projectSettings?: ProjectSettings;
}) {
  const {
    terminalsByTaskId,
    deleteTerminal: generalDeleteTerminal,
    createTerminal: generalCreateTerminal,
  } = useTerminalsContext();

  const { registerSession, unregisterSession } = usePtySession();

  const terminals = useMemo(() => terminalsByTaskId[taskId] ?? [], [terminalsByTaskId, taskId]);

  const [setupTerminals, setSetupTerminals] = useState<string[]>([]);

  useEffect(() => {
    const run = async () => {
      const raw = projectSettings?.scripts?.setup;
      const setupScripts = (Array.isArray(raw) ? raw : [raw]).filter(Boolean) as string[];
      const ids = await Promise.all(
        setupScripts.map((script) => createScriptTerminalId({ projectId, taskId, script }))
      );
      for (const id of ids) {
        registerSession(makePtySessionId(projectId, taskId, id));
        setSetupTerminals((prev) => (prev.includes(id) ? prev : [...prev, id]));
      }
    };
    void run();
  }, [projectId, taskId, registerSession, projectSettings]);

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

  useEffect(() => {
    if (terminals.length === 0) return;
    for (const terminal of terminals) {
      registerSession(makePtySessionId(projectId, taskId, terminal.id));
    }
  }, [terminals, projectId, registerSession, taskId]);

  return { terminals, createTerminal, removeTerminal, setupTerminals };
}
