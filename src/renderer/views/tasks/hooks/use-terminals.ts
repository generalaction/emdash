import { useCallback, useEffect, useMemo, useState } from 'react';
import { makePtySessionId } from '@shared/ptySessionId';
import { createScriptTerminalId, type Terminal } from '@shared/terminals';
import { ProjectSettings } from '@main/core/projects/settings/schema';
import { rpc } from '@renderer/core/ipc';
import { getPaneContainer } from '@renderer/core/pty/pane-sizing-context';
import { measureDimensions } from '@renderer/core/pty/pty-dimensions';
import { usePtySession } from '@renderer/core/pty/pty-session-context';
import { useTerminalsContext } from '@renderer/features/terminals/terminal-data-provider';

/** Measure the terminals pane using a typical monospace cell size (13px font). */
function getTerminalsPaneSize() {
  const container = getPaneContainer('terminals');
  return container ? (measureDimensions(container, 8, 16) ?? undefined) : undefined;
}

export type LifecycleScriptType = 'setup' | 'run' | 'teardown';

/** Maps each defined lifecycle script type to its deterministic terminal ID. */
type LifecycleScripts = Partial<Record<LifecycleScriptType, string>>;

/**
 * Unified renderer-side tab item. Lifecycle scripts come from project settings
 * and are never persisted to the DB; regular terminals are DB-backed.
 */
export type TerminalTabItem =
  | { kind: 'lifecycle'; type: LifecycleScriptType; id: string }
  | { kind: 'terminal'; id: string; name: string };

const scriptTypes: LifecycleScriptType[] = ['setup', 'run', 'teardown'];

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

  const [lifecycleScripts, setLifecycleScripts] = useState<LifecycleScripts>({});

  // Register session IDs for all defined lifecycle scripts and store the ID
  // mapping. Uses the type as key so re-runs of the effect never duplicate.
  useEffect(() => {
    if (!projectSettings?.scripts) return;
    for (const type of scriptTypes) {
      const script = projectSettings.scripts[type];
      if (!script) continue;
      const run = async () => {
        const id = await createScriptTerminalId({ projectId, taskId, type, script });
        registerSession(makePtySessionId(projectId, taskId, id));
        setLifecycleScripts((prev) => (prev[type] === id ? prev : { ...prev, [type]: id }));
      };
      void run();
    }
  }, [projectId, taskId, registerSession, projectSettings]);

  // Trigger a lifecycle script re-run on the main process. The session is
  // already registered from the effect above so no re-registration needed.
  const runLifecycleScript = useCallback(
    async (type: LifecycleScriptType) => {
      await rpc.terminals.runLifecycleScript({ projectId, taskId, type });
    },
    [projectId, taskId]
  );

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

  const terminalTabItems = useMemo((): TerminalTabItem[] => {
    const lifecycle = (Object.entries(lifecycleScripts) as [LifecycleScriptType, string][]).map(
      ([type, id]): TerminalTabItem => ({ kind: 'lifecycle', type, id })
    );
    const regular = terminals.map(
      (t): TerminalTabItem => ({ kind: 'terminal', id: t.id, name: t.name })
    );
    return [...lifecycle, ...regular];
  }, [lifecycleScripts, terminals]);

  return { terminalTabItems, createTerminal, removeTerminal, runLifecycleScript };
}
