import { PillTabs, type PillTab } from '@emdash/ui/react/patterns';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectView } from '@core/features/projects/browser/stores/project-view';

const projectTabs: readonly PillTab<ProjectView>[] = [
  { value: 'tasks', label: 'Tasks', icon: <span /> },
  { value: 'pull-request', label: 'Pull Requests', icon: <span /> },
  { value: 'workspaces', label: 'Workspaces', icon: <span /> },
  { value: 'settings', label: 'Settings', icon: <span /> },
];

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('Project section PillTabs', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('switches Project sections with animated presentation and keyboard navigation', async () => {
    const onChange = vi.fn();

    function Harness() {
      const [activeView, setActiveView] = useState<ProjectView>('tasks');
      return (
        <PillTabs
          items={projectTabs}
          value={activeView}
          onValueChange={(view) => {
            onChange(view);
            setActiveView(view);
          }}
          ariaLabel="Project sections"
          panelId="project-section-panel"
          labelVisibility="active-only"
        />
      );
    }

    await act(async () => root.render(<Harness />));

    const tablist = host.querySelector('[role="tablist"]');
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tablist?.getAttribute('aria-label')).toBe('Project sections');
    expect(tabs.map((tab) => tab.getAttribute('aria-label'))).toEqual([
      'Tasks',
      'Pull Requests',
      'Workspaces',
      'Settings',
    ]);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(tabs[0]?.parentElement?.hasAttribute('data-compact')).toBe(false);
    expect(tabs.slice(1).every((tab) => tab.parentElement?.dataset.compact === 'true')).toBe(true);
    expect(tabs.every((tab) => tab.getAttribute('aria-controls') === 'project-section-panel')).toBe(
      true
    );

    tabs[0]?.focus();
    await act(async () => {
      tabs[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });

    expect(onChange).toHaveBeenLastCalledWith('pull-request');
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true');

    await act(async () => {
      tabs[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith('settings');
    expect(document.activeElement).toBe(tabs[3]);
  });
});
