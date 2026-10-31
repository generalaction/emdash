import { act, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { z } from 'zod';
import { defineCommand } from '@core/primitives/commands/api';
import { defineViewScope } from '@core/primitives/view-scopes/api';
import { ViewScopes } from '@core/primitives/view-scopes/browser';
import { useViewScope, ViewScopeInstanceProvider } from './use-view-scope';

const taskScope = defineViewScope({
  id: 'test.task',
  params: z.object({ taskId: z.string() }),
  commands: [],
  activation: 'logical',
});
const cycleTab = defineCommand({ id: 'test.cycleTab', title: 'Cycle tabs', category: 'Test' });
const paneScope = defineViewScope({
  id: 'test.pane',
  params: z.object({ taskId: z.string() }),
  commands: [cycleTab],
  activation: 'focus',
});

const terminalScope = defineViewScope({
  id: 'test.terminal',
  params: z.object({}),
  commands: [],
  activation: 'focus',
  traits: ['terminal', 'text-input'],
});

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('scope registration after task navigation', () => {
  let runtime: ViewScopes;
  let host: HTMLDivElement;
  let root: Root;
  const cycle = vi.fn();

  function Task({ taskId, children }: { taskId: string; children: ReactNode }) {
    const { instance } = useViewScope(taskScope({ taskId }), {}, runtime);
    useLayoutEffect(() => {
      if (instance) runtime.activate(instance);
    }, [instance]);
    if (!instance) return null;
    return <ViewScopeInstanceProvider instance={instance}>{children}</ViewScopeInstanceProvider>;
  }
  function AutofocusInput() {
    const ref = useRef<HTMLTextAreaElement>(null);
    const { attachRef } = useViewScope(terminalScope(), {}, runtime);
    useEffect(() => {
      ref.current?.focus();
    }, []);
    return (
      <div ref={attachRef}>
        <textarea ref={ref} />
      </div>
    );
  }
  function Pane({ taskId }: { taskId: string }) {
    const { attachRef, instance } = useViewScope(
      paneScope({ taskId }),
      { 'test.cycleTab': () => ({ execute: cycle }) },
      runtime
    );
    return (
      <ViewScopeInstanceProvider instance={instance}>
        <div ref={attachRef}>
          <AutofocusInput />
        </div>
      </ViewScopeInstanceProvider>
    );
  }

  beforeEach(() => {
    runtime = new ViewScopes(document);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    cycle.mockClear();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    runtime.dispose();
    host.remove();
  });

  it('keeps pane shortcuts available after task navigation when typing already works', async () => {
    for (const taskId of [
      'project-1/task-1',
      'project-1/task-2',
      'project-1/task-1',
      'project-2/task-1',
      'project-1/task-1',
    ]) {
      await act(async () => {
        root.render(
          <Task key={taskId} taskId={taskId}>
            <Pane taskId={taskId} />
          </Task>
        );
      });
      expect(document.activeElement).toBe(host.querySelector('textarea'));
      await userEvent.keyboard('hello');
      expect(host.querySelector('textarea')?.value).toBe('hello');
      expect(runtime.activePath.map((scope) => scope.ref.scopeId)).toEqual([
        'test.terminal',
        'test.pane',
        'test.task',
      ]);
      runtime.getActiveCommand(cycleTab)?.execute(undefined, 'keybinding');
    }
    expect(cycle).toHaveBeenCalledTimes(5);
  });
});
