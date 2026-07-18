import { autorun, observable } from 'mobx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commandRegistry } from './registry';
import { SCOPE_LEVELS, type AppCommand, type CommandProvider, type ScopeId } from './types';

vi.mock('@core/primitives/views/react', () => ({
  getViewRuntime: vi.fn(),
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {},
}));

function command(
  id: string,
  shortcutKey: AppCommand['shortcutKey'],
  execute: () => void,
  enabled?: boolean
): AppCommand {
  return { id, label: id, shortcutKey, enabled, execute };
}

function provider(scopeId: ScopeId, getCommands: () => AppCommand[]): CommandProvider {
  return { scopeId, getCommands };
}

afterEach(() => {
  for (const scopeId of Object.keys(SCOPE_LEVELS) as ScopeId[]) {
    commandRegistry.unregister(scopeId);
  }
});

describe('CommandRegistry', () => {
  it('dispatches the first enabled command from the innermost scope', () => {
    const appExecute = vi.fn();
    const taskExecute = vi.fn();
    commandRegistry.register(
      provider('app', () => [command('app.settings', 'settings', appExecute)])
    );
    commandRegistry.register(
      provider('task', () => [command('task.settings', 'settings', taskExecute)])
    );

    expect(commandRegistry.dispatch('settings')).toBe(true);
    expect(taskExecute).toHaveBeenCalledOnce();
    expect(appExecute).not.toHaveBeenCalled();
  });

  it('falls through a disabled inner command to an enabled outer command', () => {
    const appExecute = vi.fn();
    const taskExecute = vi.fn();
    commandRegistry.register(
      provider('app', () => [command('app.settings', 'settings', appExecute)])
    );
    commandRegistry.register(
      provider('task', () => [command('task.settings', 'settings', taskExecute, false)])
    );

    expect(commandRegistry.dispatch('settings')).toBe(true);
    expect(appExecute).toHaveBeenCalledOnce();
    expect(taskExecute).not.toHaveBeenCalled();
  });

  it('returns false when no enabled command matches the shortcut', () => {
    commandRegistry.register(
      provider('task', () => [command('task.settings', 'settings', vi.fn(), false)])
    );

    expect(commandRegistry.dispatch('settings')).toBe(false);
  });

  it('finds a command by id from the innermost scope', () => {
    const appCommand = command('shared.command', undefined, vi.fn());
    const taskCommand = command('shared.command', undefined, vi.fn());
    commandRegistry.register(provider('app', () => [appCommand]));
    commandRegistry.register(provider('task', () => [taskCommand]));

    expect(commandRegistry.findById('shared.command')).toBe(taskCommand);
    expect(commandRegistry.findById('missing.command')).toBeUndefined();
  });

  it('reacts to provider registration and observable command reads', () => {
    const state = observable({ enabled: true });
    const snapshots: string[][] = [];
    const dispose = autorun(() => {
      snapshots.push(
        commandRegistry.activeCommands.map((entry) => `${entry.id}:${entry.enabled ?? true}`)
      );
    });

    commandRegistry.register(
      provider('app', () => [command('app.settings', 'settings', vi.fn(), state.enabled)])
    );
    state.enabled = false;
    commandRegistry.unregister('app');
    dispose();

    expect(snapshots).toEqual([[], ['app.settings:true'], ['app.settings:false'], []]);
  });

  it('replaces a provider registered for the same scope and unregisters it', () => {
    const first = command('app.first', undefined, vi.fn());
    const second = command('app.second', undefined, vi.fn());

    commandRegistry.register(provider('app', () => [first]));
    commandRegistry.register(provider('app', () => [second]));

    expect(commandRegistry.activeCommands).toEqual([second]);

    commandRegistry.unregister('app');
    expect(commandRegistry.activeCommands).toEqual([]);
  });
});
