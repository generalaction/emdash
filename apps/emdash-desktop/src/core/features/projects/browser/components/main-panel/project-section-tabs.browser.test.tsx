import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectView } from '@core/features/projects/browser/stores/project-view';
import { ProjectSectionTabs } from './active-project';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('ProjectSectionTabs', () => {
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

  it('switches the four Project sections with tab semantics and keyboard navigation', async () => {
    const onChange = vi.fn();

    function Harness() {
      const [activeView, setActiveView] = useState<ProjectView>('tasks');
      return (
        <ProjectSectionTabs
          activeView={activeView}
          onChange={(view) => {
            onChange(view);
            setActiveView(view);
          }}
        />
      );
    }

    await act(async () => root.render(<Harness />));

    const tablist = host.querySelector('[role="tablist"]');
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tablist?.getAttribute('aria-label')).toBe('Project sections');
    expect(tablist?.classList.contains('grid-cols-4')).toBe(true);
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Tasks',
      'Pull Requests',
      'Workspaces',
      'Settings',
    ]);
    expect(tabs.every((tab) => tab.querySelector('svg'))).toBe(true);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(tabs[0]?.tabIndex).toBe(0);
    expect(tabs.slice(1).every((tab) => tab.tabIndex === -1)).toBe(true);
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

    await act(async () => {
      tabs[0]?.click();
    });
    expect(onChange).toHaveBeenLastCalledWith('tasks');
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
  });
});
