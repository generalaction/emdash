import { comparer, makeAutoObservable, reaction } from 'mobx';
import { getViewRuntime } from '@core/primitives/views/react';
import type { ShortcutSettingsKey } from '@renderer/lib/hooks/useKeyboardShortcuts';
import { appState } from '@renderer/lib/stores/app-state';
import { SCOPE_LEVELS, type AppCommand, type CommandProvider, type ScopeId } from './types';

class CommandRegistry {
  private scopes = new Map<ScopeId, CommandProvider>();

  constructor() {
    makeAutoObservable(this);
  }

  register(provider: CommandProvider): void {
    this.scopes.set(provider.scopeId, provider);
  }

  unregister(scopeId: ScopeId): void {
    this.scopes.delete(scopeId);
  }

  /**
   * Walks scopes innermost-first. Calls the first enabled handler for the
   * given shortcut key and returns true. Returns false if nothing handled it.
   */
  dispatch(shortcutKey: ShortcutSettingsKey): boolean {
    for (const scope of this.sortedScopes) {
      const cmd = scope
        .getCommands()
        .find((c) => c.shortcutKey === shortcutKey && c.enabled !== false);
      if (cmd) {
        cmd.execute();
        return true;
      }
    }
    return false;
  }

  /**
   * All commands from all active scopes, innermost scope first.
   * @computed — reactive to scope registration changes and to any MobX
   * observable accessed inside each provider's getCommands().
   */
  get activeCommands(): AppCommand[] {
    return this.sortedScopes.flatMap((s) => s.getCommands());
  }

  /**
   * Looks up a live command by its ID across all active scopes, innermost first.
   * Used by the command palette to resolve FTS command results to live handlers.
   */
  findById(id: string): AppCommand | undefined {
    for (const scope of this.sortedScopes) {
      const cmd = scope.getCommands().find((c) => c.id === id);
      if (cmd) return cmd;
    }
    return undefined;
  }

  private get sortedScopes(): CommandProvider[] {
    return [...this.scopes.values()].sort(
      (a, b) => SCOPE_LEVELS[b.scopeId] - SCOPE_LEVELS[a.scopeId]
    );
  }
}

export const commandRegistry = new CommandRegistry();

/**
 * Wires a MobX reaction that keeps the task-scope CommandProvider in sync with
 * the active view. Must be called once at app startup (after navigation state
 * is restored). No React dependency — runs entirely off MobX observables.
 */
export function setupViewCommandProvider(): void {
  reaction(
    () => {
      const ref = appState.navigation.currentRef;
      return { viewId: ref.viewId, params: ref.params };
    },
    ({ viewId, params }) => {
      commandRegistry.unregister('task');
      const commandProvider = getViewRuntime(viewId)?.runtime.commandProvider as
        | ((input: typeof params) => CommandProvider)
        | undefined;
      if (commandProvider) commandRegistry.register(commandProvider(params));
    },
    { fireImmediately: true, equals: comparer.structural }
  );
}
