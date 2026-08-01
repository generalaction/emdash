import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoopAuthoringPort, LoopTabSnapshot } from './loop-authoring-port';
import { createLoopTabProvider, LoopTabPanel } from './loop-tab-provider';
import { LoopTabResource } from './loop-tab-resource';

const settings = vi.hoisted(() => ({ loops: true }));

vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({
    value: { loops: settings.loops },
    isLoading: false,
    isSaving: false,
  }),
}));

vi.mock('@renderer/features/settings/app-settings-client', () => ({
  getAppSettingValueSnapshot: () => ({ loops: settings.loops }),
}));

vi.mock('@renderer/features/tabs/tab-bar/generic-tab-item', async () => {
  const React = await import('react');
  return {
    GenericTabItem: () => React.createElement('div'),
    GenericTabDragPreview: () => React.createElement('div'),
  };
});

function readySnapshot(status: LoopTabSnapshot['status'] = 'running'): LoopTabSnapshot {
  return {
    loopId: 'loop-1',
    taskId: 'task-1',
    name: 'Ship native Loops',
    status,
    currentPhaseIndex: 0,
    phases: [
      {
        id: 'work-1',
        index: 0,
        kind: 'work',
        name: 'Implementation',
        goal: 'Build the native flow',
        status: 'passed',
        attempts: 1,
        lastError: null,
        handoff: {
          summary: 'Native flow implemented',
          risks: ['Renderer integration remains'],
          remainingWork: ['Wire the production port'],
          artifacts: [
            {
              artifactId: 'artifact-1',
              kind: 'test-report',
              label: 'Unit test report',
              byteLength: 120,
            },
          ],
        },
        evidence: [{ label: 'Unit tests', status: 'passed', summary: 'All tests passed' }],
      },
      {
        id: 'review-1',
        index: 1,
        kind: 'review',
        name: 'Review',
        goal: 'Review the complete change',
        status: 'failed',
        attempts: 1,
        lastError: 'Review found an accessibility regression.',
        handoff: null,
        evidence: [],
      },
      {
        id: 'e2e-1',
        index: 2,
        kind: 'e2e',
        name: 'E2E',
        goal: 'Verify independently',
        status: 'pending',
        attempts: 0,
        lastError: null,
        handoff: null,
        evidence: [],
      },
    ],
    browser: { kind: 'reconnecting', message: 'SSH preview is reconnecting.' },
  };
}

function port(snapshot = readySnapshot()): LoopAuthoringPort {
  return {
    loadLoop: vi.fn(async () => snapshot),
    subscribeToLoop: vi.fn(() => () => {}),
    pauseLoop: vi.fn(async () => readySnapshot('paused')),
    resumeLoop: vi.fn(async () => readySnapshot('running')),
    retryPhase: vi.fn(async () => readySnapshot('running')),
  };
}

describe('native Loop tab', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    settings.loops = true;
    dom = new JSDOM('<div id="root"></div>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('Element', dom.window.Element);
    vi.stubGlobal('Node', dom.window.Node);
    vi.stubGlobal('Event', dom.window.Event);
    vi.stubGlobal('MouseEvent', dom.window.MouseEvent);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = dom.window.document.getElementById('root')!;
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    dom.window.close();
  });

  it('creates a single-mount provider around the injected port', () => {
    const fake = port();
    const provider = createLoopTabProvider(fake);
    const resource = provider.initialize(
      { kind: 'loop', tabId: 'tab-1', isPreview: false, state: { loopId: 'loop-1' } },
      { tabId: 'tab-1', pin: vi.fn(), close: vi.fn(async () => true), open: vi.fn() },
      { viewId: 'task-1' }
    );

    expect(provider.kind).toBe('loop');
    expect(provider.mount).toBe('single');
    expect(provider.resourceKey({ loopId: 'loop-1' })).toBe('loop-1');
    expect(resource).toBeInstanceOf(LoopTabResource);
  });

  it('rejects Loop tab activation while the experiment is disabled', () => {
    settings.loops = false;
    const provider = createLoopTabProvider(port());

    expect(provider.onBeforeOpen?.({ loopId: 'loop-1' }, { viewId: 'task-1' })).toBeNull();
  });

  it('renders phase kinds, handoff, evidence, browser state, and actionable failures', async () => {
    const fake = port();
    const resource = new LoopTabResource('loop-1', fake);
    await resource.load();

    act(() => root.render(React.createElement(LoopTabPanel, { resource })));

    expect(container.querySelector('section')?.getAttribute('aria-label')).toBe(
      'Ship native Loops'
    );
    expect(container.textContent).toContain('Work');
    expect(container.textContent).toContain('Review');
    expect(container.textContent).toContain('E2E');
    expect(container.textContent).toContain('Native flow implemented');
    expect(container.textContent).toContain('All tests passed');
    expect(container.textContent).toContain('SSH preview is reconnecting.');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Review found an accessibility regression.'
    );
    expect(container.querySelector('button[aria-label="Pause Loop"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Retry Review"]')).not.toBeNull();
  });

  it('presents pause, resume, and retry controls through the resource', async () => {
    const fake = port();
    const resource = new LoopTabResource('loop-1', fake);
    await resource.load();
    act(() => root.render(React.createElement(LoopTabPanel, { resource })));

    await act(async () =>
      container
        .querySelector('button[aria-label="Pause Loop"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    );
    expect(fake.pauseLoop).toHaveBeenCalledWith('loop-1');

    expect(container.querySelector('button[aria-label="Resume Loop"]')).not.toBeNull();
    await act(async () =>
      container
        .querySelector('button[aria-label="Resume Loop"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    );
    expect(fake.resumeLoop).toHaveBeenCalledWith('loop-1');

    await act(async () =>
      container
        .querySelector('button[aria-label="Retry Review"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    );
    expect(fake.retryPhase).toHaveBeenCalledWith('loop-1', 'review-1');

    expect(container.querySelector('button[aria-label="Pause Loop"]')).not.toBeNull();
  });

  it('renders accessible loading and load-failure states with retry', async () => {
    const fake = port();
    vi.mocked(fake.loadLoop).mockRejectedValueOnce(new Error('Loop service is unavailable'));
    const resource = new LoopTabResource('loop-1', fake);

    let loading: Promise<void> | undefined;
    act(() => {
      loading = resource.load();
      root.render(React.createElement(LoopTabPanel, { resource }));
    });
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Loading Loop');
    await act(async () => loading);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Loop service is unavailable'
    );
    expect(container.querySelector('button[aria-label="Retry loading Loop"]')).not.toBeNull();
    await act(async () => {
      container
        .querySelector('button[aria-label="Retry loading Loop"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await resource.loading;
    });

    expect(fake.loadLoop).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Ship native Loops');
  });
});
