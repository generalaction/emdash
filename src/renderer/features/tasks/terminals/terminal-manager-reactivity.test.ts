import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  terminalCreatedChannel,
  terminalDeletedChannel,
  terminalUpdatedChannel,
} from '@shared/events/terminalEvents';
import type { Terminal } from '@shared/terminals';
import { TerminalManagerStore } from './terminal-manager';

const { eventHandlers } = vi.hoisted(() => ({
  eventHandlers: new Map<string, Set<(data: unknown) => void>>(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn((event: { name: string }, handler: (data: unknown) => void) => {
      const handlers = eventHandlers.get(event.name) ?? new Set<(data: unknown) => void>();
      handlers.add(handler);
      eventHandlers.set(event.name, handlers);
      return () => handlers.delete(handler);
    }),
  },
  rpc: {
    terminals: {
      getTerminalsForTask: vi.fn(async () => []),
      createTerminal: vi.fn(),
      deleteTerminal: vi.fn(),
      renameTerminal: vi.fn(),
    },
  },
}));

vi.mock('@renderer/lib/pty/pty-session', () => ({
  PtySession: class {
    pty = null;
    status = 'disconnected';
    connect = vi.fn(async () => {});
    dispose = vi.fn();

    constructor(readonly sessionId: string) {}
  },
}));

const { rpc } = await import('@renderer/lib/ipc');

function emitEvent<T>(event: { name: string }, payload: T): void {
  for (const handler of eventHandlers.get(event.name) ?? []) {
    handler(payload);
  }
}

function makeTerminal(overrides: Partial<Terminal> = {}): Terminal {
  return {
    id: 'terminal-1',
    projectId: 'project-1',
    taskId: 'task-1',
    name: 'Agent terminal',
    ...overrides,
  };
}

describe('TerminalManagerStore external reactivity', () => {
  beforeEach(() => {
    eventHandlers.clear();
    vi.clearAllMocks();
  });

  it('merges external terminal creation, update, load, and delete events', async () => {
    const terminal = makeTerminal();
    vi.mocked(rpc.terminals.getTerminalsForTask).mockResolvedValue([terminal]);
    const manager = new TerminalManagerStore('project-1', 'task-1');
    await manager.list.load();

    emitEvent(terminalCreatedChannel, terminal);

    const createdStore = manager.terminals.get(terminal.id);
    const createdSession = manager.sessions.get(terminal.id);
    expect(createdStore).toBeDefined();
    expect(createdSession).toBeDefined();
    expect(createdStore?.data.name).toBe('Agent terminal');
    expect(createdSession?.connect).not.toHaveBeenCalled();

    emitEvent(terminalUpdatedChannel, makeTerminal({ id: terminal.id, name: 'Build logs' }));

    expect(manager.terminals.get(terminal.id)).toBe(createdStore);
    expect(manager.terminals.get(terminal.id)?.data.name).toBe('Build logs');

    manager.list.setValue([makeTerminal({ id: terminal.id, name: 'Build logs' })]);

    expect(manager.terminals.get(terminal.id)).toBe(createdStore);
    expect(manager.sessions.get(terminal.id)).toBe(createdSession);
    expect(createdSession?.connect).not.toHaveBeenCalled();

    emitEvent(terminalDeletedChannel, {
      terminalId: terminal.id,
      taskId: 'task-1',
      projectId: 'project-1',
    });

    expect(createdSession?.dispose).toHaveBeenCalledTimes(1);
    expect(manager.terminals.has(terminal.id)).toBe(false);
  });
});
