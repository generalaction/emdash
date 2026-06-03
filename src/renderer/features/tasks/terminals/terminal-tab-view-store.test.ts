import { observable, runInAction } from 'mobx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { terminalRegistry } from '@renderer/features/tasks/stores/terminal-registry';
import type { Terminal } from '@shared/terminals';
import type { TerminalManagerStore, TerminalStore } from './terminal-manager';
import { TerminalTabViewStore } from './terminal-tab-view-store';

vi.mock('./terminal-manager', () => ({
  TerminalManagerStore: class {},
}));

function makeTerminal(id: string, name = 'Terminal 1'): TerminalStore {
  return {
    data: {
      id,
      projectId: 'project-1',
      taskId: 'task-1',
      shellId: 'system',
      name,
    } satisfies Terminal,
  } as TerminalStore;
}

function makeManager(terminals: TerminalManagerStore['terminals']): TerminalManagerStore {
  return { terminals, isLoaded: true, dispose: vi.fn() } as unknown as TerminalManagerStore;
}

function registryEntries(): {
  set(taskId: string, manager: TerminalManagerStore): void;
  delete(taskId: string): boolean;
} {
  return (
    terminalRegistry as unknown as {
      entries: {
        set(taskId: string, manager: TerminalManagerStore): void;
        delete(taskId: string): boolean;
      };
    }
  ).entries;
}

describe('TerminalTabViewStore', () => {
  afterEach(() => {
    terminalRegistry.release('task-1');
    registryEntries().delete('task-1');
  });

  it('syncs terminal ids when the terminal manager becomes available after construction', () => {
    const terminals = observable.map<string, TerminalStore>();
    const view = new TerminalTabViewStore(() => terminalRegistry.get('task-1') ?? null);

    runInAction(() => {
      registryEntries().set('task-1', makeManager(terminals));
      terminals.set('terminal-2', makeTerminal('terminal-2', 'Terminal 2'));
    });

    expect(view.tabOrder).toEqual(['terminal-2']);

    view.dispose();
  });

  it('reconciles restored snapshots with already-loaded terminal records', () => {
    const terminals = observable.map<string, TerminalStore>();
    terminals.set('terminal-1', makeTerminal('terminal-1', 'Terminal 1'));
    terminals.set('terminal-2', makeTerminal('terminal-2', 'Terminal 2'));
    registryEntries().set('task-1', makeManager(terminals));

    const view = new TerminalTabViewStore(() => terminalRegistry.get('task-1') ?? null);
    view.restoreSnapshot({
      tabOrder: ['terminal-2'],
      activeTabId: 'terminal-2',
    });

    expect(view.tabOrder).toEqual(['terminal-2', 'terminal-1']);
    expect(view.activeTabId).toBe('terminal-2');

    view.dispose();
  });

  it('falls back to the first live terminal when the restored active terminal is stale', () => {
    const terminals = observable.map<string, TerminalStore>();
    terminals.set('terminal-1', makeTerminal('terminal-1', 'Terminal 1'));
    terminals.set('terminal-2', makeTerminal('terminal-2', 'Terminal 2'));
    registryEntries().set('task-1', makeManager(terminals));

    const view = new TerminalTabViewStore(() => terminalRegistry.get('task-1') ?? null);
    view.restoreSnapshot({
      tabOrder: ['deleted-terminal'],
      activeTabId: 'deleted-terminal',
    });

    expect(view.tabOrder).toEqual(['terminal-1', 'terminal-2']);
    expect(view.activeTabId).toBe('terminal-1');

    view.dispose();
  });

  it('reconciles a restored snapshot after the terminal manager loads later', () => {
    const view = new TerminalTabViewStore(() => terminalRegistry.get('task-1') ?? null);
    view.restoreSnapshot({
      tabOrder: ['deleted-terminal'],
      activeTabId: 'deleted-terminal',
    });

    const terminals = observable.map<string, TerminalStore>();
    terminals.set('terminal-1', makeTerminal('terminal-1', 'Terminal 1'));

    runInAction(() => {
      registryEntries().set('task-1', makeManager(terminals));
    });

    expect(view.tabOrder).toEqual(['terminal-1']);
    expect(view.activeTabId).toBe('terminal-1');

    view.dispose();
  });
});
