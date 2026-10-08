import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseOpenInAppsResult } from './useOpenInApps';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  checkInstalledApps: vi.fn(),
  getPlatform: vi.fn(),
}));

vi.mock('@core/features/settings/api/browser/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({
    value: { hidden: [] },
    update: vi.fn(),
    isLoading: false,
  }),
}));

vi.mock('@core/primitives/desktop-host/browser/host-client', () => ({
  getHostClient: async () => ({
    checkInstalledApps: mocks.checkInstalledApps,
    getPlatform: mocks.getPlatform,
  }),
}));

vi.mock('@core/primitives/logging/browser/logger', () => ({ log: { warn: vi.fn() } }));

const { useOpenInApps } = await import('./useOpenInApps');

async function flushQueries(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe('useOpenInApps', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;
  let queryClient: QueryClient;
  let latest: UseOpenInAppsResult | null;

  function Probe() {
    latest = useOpenInApps();
    return null;
  }

  async function renderProbe() {
    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(Probe)
        )
      );
      await flushQueries();
    });
    await act(flushQueries);
  }

  beforeEach(() => {
    latest = null;
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    container = dom.window.document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
  });

  afterEach(async () => {
    await queryClient.cancelQueries();
    await act(async () => {
      await flushQueries();
      root.unmount();
    });
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    queryClient.clear();
    dom.window.close();
  });

  it('does not expose macOS-only apps before the platform query resolves', async () => {
    mocks.getPlatform.mockReturnValue(new Promise(() => {}));
    mocks.checkInstalledApps.mockReturnValue(new Promise(() => {}));

    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(Probe)
        )
      );
    });

    expect(latest?.loading).toBe(true);
    expect(latest?.installedApps).toEqual([]);
    expect(latest?.labels.finder).toBeUndefined();
  });

  it('uses resolved Windows labels and filters out macOS-only apps', async () => {
    mocks.getPlatform.mockResolvedValue('win32');
    mocks.checkInstalledApps.mockResolvedValue({
      cursor: 'detected',
      finder: 'detected',
      terminal: 'detected',
      xcode: 'not-detected',
    });

    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(Probe)
        )
      );
    });

    await act(async () => {
      await flushQueries();
    });

    expect(latest?.platform).toBe('win32');
    expect(latest?.labels.finder).toBe('Explorer');
    expect(latest?.installedApps.map((app) => app.id)).toEqual(
      expect.arrayContaining(['finder', 'terminal', 'cursor'])
    );
    expect(latest?.installedApps.map((app) => app.id)).not.toContain('xcode');
  });

  it('keeps Finder detected while other apps are still being checked', async () => {
    mocks.getPlatform.mockResolvedValue('darwin');
    mocks.checkInstalledApps.mockReturnValue(new Promise(() => {}));
    await renderProbe();
    expect(latest?.availability.finder).toBe('detected');
    expect(latest?.availability.zed).toBe('checking');
    expect(latest?.hasDetectionProblem).toBe(false);
    expect(mocks.checkInstalledApps).toHaveBeenCalledWith(undefined, { timeoutMs: 60_000 });
  });

  it('exposes request failures as unknown, then recovers on explicit retry', async () => {
    mocks.getPlatform.mockResolvedValue('darwin');
    mocks.checkInstalledApps.mockRejectedValueOnce(new Error('Wire request timed out'));
    await renderProbe();
    expect(latest?.availability.zed).toBe('unknown');
    expect(latest?.availability.finder).toBe('detected');
    expect(latest?.hasDetectionProblem).toBe(true);
    expect(mocks.checkInstalledApps).toHaveBeenCalledTimes(1);
    mocks.checkInstalledApps.mockResolvedValue({ zed: 'detected' });
    await act(async () => {
      latest?.refresh();
      await flushQueries();
    });
    await act(flushQueries);
    expect(latest?.availability.zed).toBe('detected');
    expect(mocks.checkInstalledApps).toHaveBeenCalledTimes(2);
  });

  it('preserves known apps during a background refresh and a failed refresh', async () => {
    mocks.getPlatform.mockResolvedValue('win32');
    mocks.checkInstalledApps.mockResolvedValue({
      vscode: 'detected',
      cursor: 'not-detected',
      zed: 'unknown',
    });
    await renderProbe();
    let rejectRefresh: (error: Error) => void = () => {};
    mocks.checkInstalledApps.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectRefresh = reject;
        })
    );
    await act(async () => {
      latest?.refresh();
      await flushQueries();
    });
    expect(latest?.availability.vscode).toBe('detected');
    expect(latest?.availability.cursor).toBe('not-detected');
    expect(latest?.availability.zed).toBe('unknown');
    await act(async () => {
      rejectRefresh(new Error('Disconnected'));
      await flushQueries();
    });
    await act(flushQueries);
    expect(latest?.availability.vscode).toBe('detected');
    expect(latest?.hasDetectionProblem).toBe(true);
  });

  it('flags unknown results and omits confirmed absences from installed apps', async () => {
    mocks.getPlatform.mockResolvedValue('win32');
    mocks.checkInstalledApps.mockResolvedValue({ vscode: 'unknown', cursor: 'not-detected' });
    await renderProbe();
    expect(latest?.availability.vscode).toBe('unknown');
    expect(latest?.hasDetectionProblem).toBe(true);
    expect(latest?.installedApps.map((app) => app.id)).not.toContain('cursor');
  });
});
