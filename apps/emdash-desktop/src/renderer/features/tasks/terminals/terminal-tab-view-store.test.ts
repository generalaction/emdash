import { observable, runInAction } from 'mobx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TerminalRegistry,
  terminalRegistry,
  terminalRegistryKey,
} from '@renderer/features/tasks/stores/terminal-registry';
import type { Terminal } from '@shared/core/terminals/terminals';
import type { TerminalManagerStore, TerminalStore } from './terminal-manager';
import { TerminalTabViewStore } from './terminal-tab-view-store';

vi.mock('./terminal-manager', () => ({
  TerminalManagerStore: class {
    dispose() {}
  },
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

function makeLoadingManager(terminals: TerminalManagerStore['terminals']): TerminalManagerStore & {
  isLoaded: boolean;
} {
  return observable({
    terminals,
    isLoaded: false,
    dispose: vi.fn(),
  }) as unknown as TerminalManagerStore & { isLoaded: boolean };
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

describe('TerminalRegistry', () => {
  it('keeps stores for the same task id in different projects independent', () => {
    const registry = new TerminalRegistry();
    const first = registry.acquire('project-1', 'shared-task');
    const second = registry.acquire('project-2', 'shared-task');

    expect(second).not.toBe(first);
    expect(registry.get('project-1', 'shared-task')).toBe(first);
    expect(registry.get('project-2', 'shared-task')).toBe(second);

    registry.release('project-1', 'shared-task');
    expect(registry.get('project-2', 'shared-task')).toBe(second);
    registry.release('project-2', 'shared-task');
  });
});

describe('TerminalTabViewStore', () => {
  afterEach(() => {
    terminalRegistry.release('project-1', 'task-1');
    registryEntries().delete(terminalRegistryKey('project-1', 'task-1'));
  });

  it('syncs terminal ids when the terminal manager becomes available after construction', () => {
    const terminals = observable.map<string, TerminalStore>();
    const view = new TerminalTabViewStore(
      () => terminalRegistry.get('project-1', 'task-1') ?? null
    );

    runInAction(() => {
      registryEntries().set(terminalRegistryKey('project-1', 'task-1'), makeManager(terminals));
      terminals.set('terminal-2', makeTerminal('terminal-2', 'Terminal 2'));
    });

    expect(view.tabOrder).toEqual(['terminal-2']);

    view.dispose();
  });

  it('reconciles restored snapshots with already-loaded terminal records', () => {
    const terminals = observable.map<string, TerminalStore>();
    terminals.set('terminal-1', makeTerminal('terminal-1', 'Terminal 1'));
    terminals.set('terminal-2', makeTerminal('terminal-2', 'Terminal 2'));
    registryEntries().set(terminalRegistryKey('project-1', 'task-1'), makeManager(terminals));

    const view = new TerminalTabViewStore(
      () => terminalRegistry.get('project-1', 'task-1') ?? null
    );
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
    registryEntries().set(terminalRegistryKey('project-1', 'task-1'), makeManager(terminals));

    const view = new TerminalTabViewStore(
      () => terminalRegistry.get('project-1', 'task-1') ?? null
    );
    view.restoreSnapshot({
      tabOrder: ['deleted-terminal'],
      activeTabId: 'deleted-terminal',
    });

    expect(view.tabOrder).toEqual(['terminal-1', 'terminal-2']);
    expect(view.activeTabId).toBe('terminal-1');

    view.dispose();
  });

  it('reconciles a restored snapshot after the terminal manager loads later', () => {
    const view = new TerminalTabViewStore(
      () => terminalRegistry.get('project-1', 'task-1') ?? null
    );
    view.restoreSnapshot({
      tabOrder: ['deleted-terminal'],
      activeTabId: 'deleted-terminal',
    });

    const terminals = observable.map<string, TerminalStore>();
    terminals.set('terminal-1', makeTerminal('terminal-1', 'Terminal 1'));

    runInAction(() => {
      registryEntries().set(terminalRegistryKey('project-1', 'task-1'), makeManager(terminals));
    });

    expect(view.tabOrder).toEqual(['terminal-1']);
    expect(view.activeTabId).toBe('terminal-1');

    view.dispose();
  });

  it('clears stale restored ids when an empty terminal list finishes loading', () => {
    const terminals = observable.map<string, TerminalStore>();
    const manager = makeLoadingManager(terminals);
    registryEntries().set(terminalRegistryKey('project-1', 'task-1'), manager);

    const view = new TerminalTabViewStore(
      () => terminalRegistry.get('project-1', 'task-1') ?? null
    );
    view.restoreSnapshot({
      tabOrder: ['deleted-terminal'],
      activeTabId: 'deleted-terminal',
    });

    runInAction(() => {
      manager.isLoaded = true;
    });

    expect(view.tabOrder).toEqual([]);
    expect(view.activeTabId).toBeUndefined();

    view.dispose();
  });
});
