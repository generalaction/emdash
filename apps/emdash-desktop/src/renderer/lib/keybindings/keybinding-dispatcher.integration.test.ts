import { describe, expect, it, vi } from 'vitest';
import {
  archiveTaskCommand,
  newConversationCommand,
} from '@core/features/tasks/contributions/commands';
import { taskViewScope } from '@core/features/tasks/contributions/scopes';
import { settingsCommand } from '@core/features/workbench/contributions/commands';
import { windowScope } from '@core/manifests/browser/scope-catalog';
import { COMMAND_CATALOG } from '@core/manifests/shared/command-catalog';
import { KeybindingService } from '@core/primitives/keybindings/browser/keybinding-service';
import {
  disabled,
  enabled,
  type CommandAvailability,
  type ViewScopeDefinition,
  type ViewScopeImpl,
} from '@core/primitives/view-scopes/api';
import { ViewScopes } from '@core/primitives/view-scopes/browser';
import { KeybindingDispatcher } from './keybinding-dispatcher';

function implementationFor<TDefinition extends ViewScopeDefinition>(
  definition: TDefinition,
  execute: (commandId: string) => void,
  availability: Readonly<Record<string, CommandAvailability>> = {}
): ViewScopeImpl<TDefinition> {
  return Object.fromEntries(
    definition.commands.map((command) => [
      command.id,
      () => ({
        availability: () => availability[command.id] ?? enabled,
        execute: () => execute(command.id),
      }),
    ])
  ) as unknown as ViewScopeImpl<TDefinition>;
}

function eventFor(key: string, code: string) {
  return {
    key,
    code,
    ctrlKey: false,
    metaKey: true,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    target: null,
    getModifierState: (modifier: string) => modifier === 'Meta',
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as KeyboardEvent;
}

function createRuntime(
  execute: (commandId: string) => void,
  taskAvailability: Readonly<Record<string, CommandAvailability>> = {}
) {
  const runtime = new ViewScopes(undefined);
  const root = runtime.instantiate(windowScope(), {
    impl: implementationFor(windowScope, execute),
  });
  const task = runtime.instantiate(taskViewScope({ projectId: 'project-1', taskId: 'task-1' }), {
    parent: root,
    impl: implementationFor(taskViewScope, execute, taskAvailability),
  });
  runtime.activate(task);
  return runtime;
}

describe('KeybindingDispatcher catalog integration', () => {
  it('dispatches task and window commands through the active scope path', () => {
    const execute = vi.fn();
    const runtime = createRuntime(execute);
    const dispatcher = new KeybindingDispatcher(
      new KeybindingService(COMMAND_CATALOG.defs, { os: 'linux' }),
      runtime
    );

    expect(dispatcher.dispatch(eventFor(',', 'Comma')).kind).toBe('winner');
    expect(execute).toHaveBeenCalledWith(settingsCommand.id);

    expect(dispatcher.dispatch(eventFor('t', 'KeyT')).kind).toBe('winner');
    expect(execute).toHaveBeenCalledWith(newConversationCommand.id);
    runtime.dispose();
  });

  it('consumes disabled catalog commands and applies text-input gating', () => {
    const execute = vi.fn();
    const runtime = createRuntime(execute, {
      [newConversationCommand.id]: disabled('Unavailable'),
    });
    const dispatcher = new KeybindingDispatcher(
      new KeybindingService(COMMAND_CATALOG.defs, { os: 'linux' }),
      runtime
    );

    expect(dispatcher.dispatch(eventFor('t', 'KeyT'))).toEqual({
      kind: 'consumed',
      commandId: newConversationCommand.id,
    });
    expect(
      dispatcher.dispatchSynthetic(new Set([archiveTaskCommand.id]), {
        textInputFocused: true,
        editorFocused: true,
        terminalFocused: false,
        browserFocused: false,
      }).kind
    ).toBe('none');
    expect(execute).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it('preserves terminal shortcuts on non-mac platforms unless explicitly allowed', () => {
    const execute = vi.fn();
    const runtime = createRuntime(execute);
    const dispatcher = new KeybindingDispatcher(
      new KeybindingService(COMMAND_CATALOG.defs, { os: 'linux' }),
      runtime,
      { os: 'linux' }
    );

    expect(
      dispatcher.dispatchSynthetic(new Set([archiveTaskCommand.id]), {
        textInputFocused: true,
        editorFocused: false,
        terminalFocused: true,
        browserFocused: false,
      }).kind
    ).toBe('none');
    expect(execute).not.toHaveBeenCalled();
    runtime.dispose();
  });
});
