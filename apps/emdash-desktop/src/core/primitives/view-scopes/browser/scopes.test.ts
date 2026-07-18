import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineCommand } from '@core/primitives/commands/api';
import {
  defineViewScope,
  disabled,
  hidden,
  type ViewScopeImpl,
} from '@core/primitives/view-scopes/api';
import { registerViewScopeImpl, unregisterViewScopeImpl } from './impl-registry';
import { ViewScopes } from './scopes';

const archiveCommand = defineCommand({
  id: 'task.archive',
  title: 'Archive Task',
  category: 'Task',
});
const pinCommand = defineCommand({
  id: 'task.pin',
  title: 'Pin Task',
  category: 'Task',
});
const createBranchCommand = defineCommand({
  id: 'task.createBranch',
  title: 'Create Branch',
  category: 'Git',
  input: z.object({ branchName: z.string(), baseRef: z.string() }),
});

const windowScope = defineViewScope({
  id: 'window',
  params: z.object({}),
  commands: [archiveCommand],
  activation: 'logical',
});
const taskScope = defineViewScope({
  id: 'view.task',
  params: z.object({ taskId: z.string() }),
  commands: [archiveCommand, pinCommand, createBranchCommand],
  activation: 'logical',
  key: ({ taskId }) => taskId,
});
const capturingScope = defineViewScope({
  id: 'modal',
  params: z.object({}),
  commands: [],
  activation: 'focus',
  traits: ['capturing'],
});
const focusScope = defineViewScope({
  id: 'terminal',
  params: z.object({ terminalId: z.string() }),
  commands: [archiveCommand],
  activation: 'focus',
});

afterEach(() => {
  unregisterViewScopeImpl(taskScope);
});

describe('ViewScopes', () => {
  it('resolves and executes the innermost enabled command', () => {
    const outerExecute = vi.fn();
    const innerExecute = vi.fn();
    const scopes = new ViewScopes(undefined);
    const outer = scopes.instantiate(windowScope(), {
      impl: { 'task.archive': () => ({ execute: outerExecute }) },
    });
    const inner = scopes.instantiate(taskScope({ taskId: 'task-1' }), {
      parent: outer,
      impl: {
        'task.archive': () => ({ execute: innerExecute }),
        'task.pin': () => ({ execute: vi.fn() }),
        'task.createBranch': () => ({ execute: vi.fn() }),
      },
    });
    scopes.activate(inner);

    const hit = scopes.execute(archiveCommand, undefined, 'keybinding');

    expect(hit.kind).toBe('winner');
    expect(innerExecute).toHaveBeenCalledWith(undefined, 'keybinding');
    expect(outerExecute).not.toHaveBeenCalled();
    scopes.dispose();
  });

  it('lets a disabled inner binding consume without falling through', () => {
    const outerExecute = vi.fn();
    const innerExecute = vi.fn();
    const scopes = new ViewScopes(undefined);
    const outer = scopes.instantiate(windowScope(), {
      impl: { 'task.archive': () => ({ execute: outerExecute }) },
    });
    const inner = scopes.instantiate(taskScope({ taskId: 'task-1' }), {
      parent: outer,
      impl: {
        'task.archive': () => ({
          availability: () => disabled('Already archived'),
          execute: innerExecute,
        }),
        'task.pin': () => ({ execute: vi.fn() }),
        'task.createBranch': () => ({ execute: vi.fn() }),
      },
    });
    scopes.activate(inner);

    expect(scopes.execute(archiveCommand, undefined)).toEqual({
      kind: 'consumed',
      commandId: 'task.archive',
    });
    expect(innerExecute).not.toHaveBeenCalled();
    expect(outerExecute).not.toHaveBeenCalled();
    scopes.dispose();
  });

  it('skips hidden bindings and continues to an outer scope', () => {
    const outerExecute = vi.fn();
    const scopes = new ViewScopes(undefined);
    const outer = scopes.instantiate(windowScope(), {
      impl: { 'task.archive': () => ({ execute: outerExecute }) },
    });
    const inner = scopes.instantiate(taskScope({ taskId: 'task-1' }), {
      parent: outer,
      impl: {
        'task.archive': () => ({ availability: () => hidden, execute: vi.fn() }),
        'task.pin': () => ({ execute: vi.fn() }),
        'task.createBranch': () => ({ execute: vi.fn() }),
      },
    });
    scopes.activate(inner);

    expect(scopes.execute(archiveCommand, undefined).kind).toBe('winner');
    expect(outerExecute).toHaveBeenCalledOnce();
    scopes.dispose();
  });

  it('truncates resolution at a capturing scope', () => {
    const outerExecute = vi.fn();
    const scopes = new ViewScopes(undefined);
    const outer = scopes.instantiate(windowScope(), {
      impl: { 'task.archive': () => ({ execute: outerExecute }) },
    });
    const modal = scopes.instantiate(capturingScope(), { parent: outer, impl: {} });
    scopes.activate(modal);

    expect(scopes.resolveKeybinding(new Set(['task.archive']))).toEqual({ kind: 'none' });
    expect(outerExecute).not.toHaveBeenCalled();
    scopes.dispose();
  });

  it('resolves multiple keybinding candidates once in declaration order', () => {
    const archiveExecute = vi.fn();
    const pinExecute = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const scopes = new ViewScopes(undefined);
    const task = scopes.instantiate(taskScope({ taskId: 'task-1' }), {
      impl: {
        'task.archive': () => ({ execute: archiveExecute }),
        'task.pin': () => ({ execute: pinExecute }),
        'task.createBranch': () => ({ execute: vi.fn() }),
      },
    });
    scopes.activate(task);

    const hit = scopes.resolveKeybinding(new Set(['task.pin', 'task.archive']));

    expect(hit.kind).toBe('winner');
    if (hit.kind === 'winner') {
      expect(hit.command.def).toBe(archiveCommand);
      void hit.command.execute(undefined, 'keybinding');
    }
    expect(archiveExecute).toHaveBeenCalledOnce();
    expect(pinExecute).not.toHaveBeenCalled();
    if (import.meta.env.DEV) expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
    scopes.dispose();
  });

  it('lets a disabled earlier candidate consume before an enabled sibling', () => {
    const pinExecute = vi.fn();
    const scopes = new ViewScopes(undefined);
    const task = scopes.instantiate(taskScope({ taskId: 'task-1' }), {
      impl: {
        'task.archive': () => ({
          availability: () => disabled('Unavailable'),
          execute: vi.fn(),
        }),
        'task.pin': () => ({ execute: pinExecute }),
        'task.createBranch': () => ({ execute: vi.fn() }),
      },
    });
    scopes.activate(task);

    expect(scopes.resolveKeybinding(new Set(['task.archive', 'task.pin']))).toEqual({
      kind: 'consumed',
      commandId: 'task.archive',
    });
    expect(pinExecute).not.toHaveBeenCalled();
    scopes.dispose();
  });

  it('disposes an instance subtree and removes it from the active path', () => {
    const scopes = new ViewScopes(undefined);
    const outer = scopes.instantiate(windowScope(), {
      impl: { 'task.archive': () => ({ execute: vi.fn() }) },
    });
    const inner = scopes.instantiate(taskScope({ taskId: 'task-1' }), {
      parent: outer,
      impl: {
        'task.archive': () => ({ execute: vi.fn() }),
        'task.pin': () => ({ execute: vi.fn() }),
        'task.createBranch': () => ({ execute: vi.fn() }),
      },
    });
    scopes.activate(inner);

    outer.dispose();

    expect(outer.isDisposed).toBe(true);
    expect(inner.isDisposed).toBe(true);
    expect(scopes.activePath).toEqual([]);
    expect(scopes.get(taskScope({ taskId: 'task-1' }))).toBeUndefined();
    scopes.dispose();
  });

  it('falls back to the nearest live ancestor when an active subtree is disposed', () => {
    const scopes = new ViewScopes(undefined);
    const outer = scopes.instantiate(windowScope(), {
      impl: { 'task.archive': () => ({ execute: vi.fn() }) },
    });
    const middle = scopes.instantiate(taskScope({ taskId: 'task-1' }), {
      parent: outer,
      impl: {
        'task.archive': () => ({ execute: vi.fn() }),
        'task.pin': () => ({ execute: vi.fn() }),
        'task.createBranch': () => ({ execute: vi.fn() }),
      },
    });
    const inner = scopes.instantiate(taskScope({ taskId: 'task-2' }), {
      parent: middle,
      impl: {
        'task.archive': () => ({ execute: vi.fn() }),
        'task.pin': () => ({ execute: vi.fn() }),
        'task.createBranch': () => ({ execute: vi.fn() }),
      },
    });
    scopes.activate(inner);

    middle.dispose();

    expect(middle.isDisposed).toBe(true);
    expect(inner.isDisposed).toBe(true);
    expect(scopes.activePath).toEqual([outer]);
    scopes.dispose();
  });

  it('activates focus scopes through one delegated focus listener', () => {
    const dom = new JSDOM('<div id="root"><input id="terminal" /></div>');
    const scopes = new ViewScopes(dom.window.document);
    const outer = scopes.instantiate(windowScope(), {
      impl: { 'task.archive': () => ({ execute: vi.fn() }) },
    });
    const terminal = scopes.instantiate(focusScope({ terminalId: 'terminal-1' }), {
      parent: outer,
      impl: { 'task.archive': () => ({ execute: vi.fn() }) },
    });
    scopes.activate(outer);
    const input = dom.window.document.querySelector<HTMLInputElement>('#terminal');
    expect(input).not.toBeNull();
    terminal.attachRef(input);

    input?.dispatchEvent(new dom.window.FocusEvent('focusin', { bubbles: true }));

    expect(scopes.activePath.map((handle) => handle.ref.scopeId)).toEqual(['terminal', 'window']);
    expect(input?.getAttribute('data-view-scope')).toBe(terminal.id);
    scopes.dispose();
  });

  it('returns detached handles only for registered logical scopes', () => {
    const implementation: ViewScopeImpl<typeof taskScope> = {
      'task.archive': () => ({ execute: vi.fn() }),
      'task.pin': () => ({ execute: vi.fn() }),
      'task.createBranch': () => ({ execute: vi.fn() }),
    };
    registerViewScopeImpl(taskScope, implementation);
    const scopes = new ViewScopes(undefined);

    expect(scopes.get(taskScope({ taskId: 'task-1' }))).toBeDefined();
    expect(scopes.get(focusScope({ terminalId: 'terminal-1' }))).toBeUndefined();
    scopes.dispose();
  });

  it('rejects incomplete instance implementations in development', () => {
    const scopes = new ViewScopes(undefined);

    if (import.meta.env.DEV) {
      expect(() =>
        scopes.instantiate(taskScope({ taskId: 'task-1' }), { impl: {} as never })
      ).toThrow(
        'View scope implementation view.task is missing command bindings: task.archive, task.pin, task.createBranch'
      );
    }
    scopes.dispose();
  });

  it('validates explicit command input before invoking a binding', () => {
    const execute = vi.fn();
    const implementation: ViewScopeImpl<typeof taskScope> = {
      'task.archive': () => ({ execute: vi.fn() }),
      'task.pin': () => ({ execute: vi.fn() }),
      'task.createBranch': () => ({ execute }),
    };
    registerViewScopeImpl(taskScope, implementation);
    const scopes = new ViewScopes(undefined);
    const handle = scopes.get(taskScope({ taskId: 'task-1' }));
    const command = handle?.getCommand(createBranchCommand);

    expect(() => command?.execute({ branchName: 'feature', baseRef: 1 } as never)).toThrow();
    void command?.execute({ branchName: 'feature', baseRef: 'main' });
    expect(execute).toHaveBeenCalledWith(
      { branchName: 'feature', baseRef: 'main' },
      'programmatic'
    );
    scopes.dispose();
  });
});
