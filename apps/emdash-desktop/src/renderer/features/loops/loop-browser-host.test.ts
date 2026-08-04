import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWebviewAdapter } from '@renderer/features/browser/browser-webview-types';
import { LOOP_BROWSER_DISPOSABLE_PARTITION_PREFIX } from '@shared/core/loops/loop-browser-contracts';
import {
  loopBrowserCloseChannel,
  loopBrowserRequestChannel,
} from '@shared/events/loopBrowserEvents';
import { LoopBrowserHost } from './loop-browser-host';

const ipc = vi.hoisted(() => {
  const listeners = new Map<string, Set<(message: unknown) => void>>();
  return {
    listeners,
    emitted: [] as Array<{ name: string; message: unknown }>,
    clearData: vi.fn(),
    unregisterSession: vi.fn(),
  };
});

let latestHostProps: Record<string, unknown> | null = null;

vi.mock('@renderer/features/browser/browser-webview-host', async () => {
  const React = await import('react');
  return {
    BrowserWebviewHost: (props: Record<string, unknown>) => {
      latestHostProps = props;
      React.useEffect(
        () => () => {
          (props.onDisposed as (() => void) | undefined)?.();
        },
        [props]
      );
      return React.createElement('div', { 'data-testid': 'loop-webview-host' });
    },
  };
});

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: (event: { name: string }, listener: (message: unknown) => void) => {
      const listeners = ipc.listeners.get(event.name) ?? new Set();
      listeners.add(listener);
      ipc.listeners.set(event.name, listeners);
      return () => listeners.delete(listener);
    },
    emit: (event: { name: string }, message: unknown) => {
      ipc.emitted.push({ name: event.name, message });
    },
  },
  rpc: {
    browser: {
      clearData: ipc.clearData,
      unregisterSession: ipc.unregisterSession,
    },
  },
}));

const request = {
  type: 'request' as const,
  verificationRunId: 'run-1',
  browserId: 'browser-1',
  projectId: 'project-1',
  taskId: 'task-1',
  workspaceId: 'workspace-1',
  partition: `${LOOP_BROWSER_DISPOSABLE_PARTITION_PREFIX}run-1`,
  allowedPreviewOrigin: 'http://127.0.0.1:4173',
  previewUrl: 'http://127.0.0.1:4173/settings',
  requestedAt: '2026-07-11T12:00:00.000Z',
};

function dispatch(name: string, message: unknown): void {
  for (const listener of ipc.listeners.get(name) ?? []) listener(message);
}

describe('LoopBrowserHost', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    dom = new JSDOM('<div id="root"></div>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('Element', dom.window.Element);
    vi.stubGlobal('Node', dom.window.Node);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = dom.window.document.getElementById('root')!;
    root = createRoot(container);
    latestHostProps = null;
    ipc.listeners.clear();
    ipc.emitted.length = 0;
    ipc.clearData.mockResolvedValue({ success: true });
    ipc.unregisterSession.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    dom.window.close();
  });

  it('mounts a context-free hidden host and emits ready only after successful binding', async () => {
    await act(async () => root.render(React.createElement(LoopBrowserHost)));
    act(() => dispatch(loopBrowserRequestChannel.name, request));

    expect(container.querySelector('[data-testid="loop-webview-host"]')).not.toBeNull();
    expect(latestHostProps).toMatchObject({
      lifecycleKey: expect.stringContaining('run-1'),
      browserId: 'browser-1',
      partition: request.partition,
      src: request.previewUrl,
      registration: 'main',
      hidden: true,
      allowPopups: false,
    });
    expect(ipc.emitted).toEqual([]);

    const adapter = {
      currentUrl: () => request.previewUrl,
    } as BrowserWebviewAdapter;
    act(() =>
      (
        latestHostProps?.onBound as
          | ((binding: { adapter: BrowserWebviewAdapter }) => void)
          | undefined
      )?.({
        adapter,
      })
    );

    expect(ipc.emitted).toHaveLength(1);
    expect(ipc.emitted[0]).toMatchObject({
      name: 'loop-browser:ready',
      message: { type: 'ready', verificationRunId: 'run-1', currentUrl: request.previewUrl },
    });
  });

  it('keeps an active lease immutable when its run id is replayed with new ownership', async () => {
    await act(async () => root.render(React.createElement(LoopBrowserHost)));
    act(() => dispatch(loopBrowserRequestChannel.name, request));

    act(() =>
      dispatch(loopBrowserRequestChannel.name, {
        ...request,
        browserId: 'forged-browser',
        projectId: 'forged-project',
        taskId: 'forged-task',
        workspaceId: 'forged-workspace',
        partition: `${LOOP_BROWSER_DISPOSABLE_PARTITION_PREFIX}forged-run`,
        allowedPreviewOrigin: 'http://127.0.0.1:5173',
        previewUrl: 'http://127.0.0.1:5173/',
      })
    );

    expect(latestHostProps).toMatchObject({
      browserId: request.browserId,
      partition: request.partition,
      src: request.previewUrl,
    });
  });

  it('ignores stale close messages and acknowledges exact teardown after cleanup', async () => {
    await act(async () => root.render(React.createElement(LoopBrowserHost)));
    act(() => dispatch(loopBrowserRequestChannel.name, request));
    act(() =>
      dispatch(loopBrowserCloseChannel.name, {
        ...request,
        type: 'close',
        workspaceId: 'stale-workspace',
        reason: 'cancelled',
        previewUrl: undefined,
        requestedAt: undefined,
      })
    );
    expect(container.querySelector('[data-testid="loop-webview-host"]')).not.toBeNull();

    await act(async () =>
      dispatch(loopBrowserCloseChannel.name, {
        type: 'close',
        verificationRunId: request.verificationRunId,
        browserId: request.browserId,
        projectId: request.projectId,
        taskId: request.taskId,
        workspaceId: request.workspaceId,
        partition: request.partition,
        allowedPreviewOrigin: request.allowedPreviewOrigin,
        reason: 'cancelled',
      })
    );
    await vi.waitFor(() => expect(ipc.emitted.at(-1)?.name).toBe('loop-browser:closed'));

    expect(container.querySelector('[data-testid="loop-webview-host"]')).toBeNull();
    expect(ipc.clearData).not.toHaveBeenCalled();
    expect(ipc.unregisterSession).not.toHaveBeenCalled();
    expect(ipc.emitted.at(-1)).toMatchObject({
      name: 'loop-browser:closed',
      message: {
        type: 'closed',
        verificationRunId: 'run-1',
        reason: 'cancelled',
        partitionDataCleared: false,
      },
    });

    act(() => dispatch(loopBrowserRequestChannel.name, request));
    expect(container.querySelector('[data-testid="loop-webview-host"]')).toBeNull();

    const replacement = {
      ...request,
      browserId: 'browser-2',
      partition: `${LOOP_BROWSER_DISPOSABLE_PARTITION_PREFIX}run-1-replacement`,
    };
    act(() => dispatch(loopBrowserRequestChannel.name, replacement));

    expect(latestHostProps).toMatchObject({
      browserId: replacement.browserId,
      partition: replacement.partition,
      src: replacement.previewUrl,
    });
  });

  it('finishes an origin-rotation teardown before mounting the replacement lease', async () => {
    await act(async () => root.render(React.createElement(LoopBrowserHost)));
    act(() => dispatch(loopBrowserRequestChannel.name, request));
    await act(async () =>
      dispatch(loopBrowserCloseChannel.name, {
        type: 'close',
        verificationRunId: request.verificationRunId,
        browserId: request.browserId,
        projectId: request.projectId,
        taskId: request.taskId,
        workspaceId: request.workspaceId,
        partition: request.partition,
        allowedPreviewOrigin: request.allowedPreviewOrigin,
        reason: 'origin-changed',
      })
    );
    await vi.waitFor(() => expect(ipc.emitted.at(-1)?.name).toBe('loop-browser:closed'));

    const rotated = {
      ...request,
      verificationRunId: 'run-2',
      browserId: 'browser-2',
      partition: `${LOOP_BROWSER_DISPOSABLE_PARTITION_PREFIX}run-2`,
      allowedPreviewOrigin: 'http://127.0.0.1:5173',
      previewUrl: 'http://127.0.0.1:5173/settings',
    };
    act(() => dispatch(loopBrowserRequestChannel.name, rotated));

    expect(latestHostProps).toMatchObject({
      browserId: 'browser-2',
      partition: rotated.partition,
      src: rotated.previewUrl,
    });
  });
});
