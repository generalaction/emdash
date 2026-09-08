import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullRequest } from '@core/services/pull-requests/api';
import { CHECK_RUN_POLL_INTERVAL_MS, useSyncCheckRuns } from './use-check-runs';

const mocks = vi.hoisted(() => ({
  getPullRequestsRuntimeClient: vi.fn(),
}));

vi.mock('@core/services/pull-requests/api/client', () => ({
  getPullRequestsRuntimeClient: mocks.getPullRequestsRuntimeClient,
}));

const pullRequest = {
  repositoryUrl: 'https://github.com/generalaction/emdash',
  url: 'https://github.com/generalaction/emdash/pull/1',
  headRefOid: 'head-1',
  checks: [],
} as unknown as PullRequest;

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('useSyncCheckRuns', () => {
  let dom: JSDOM;
  let root: Root;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    Object.defineProperty(dom.window.document, 'hidden', { configurable: true, value: false });
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.useFakeTimers();
    root = createRoot(dom.window.document.getElementById('root') as HTMLDivElement);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    dom.window.close();
  });

  function Probe({ pr = pullRequest }: { pr?: PullRequest }) {
    useSyncCheckRuns(pr);
    return null;
  }

  it('polls active checks until they complete', async () => {
    const syncChecks = vi
      .fn()
      .mockResolvedValueOnce({ success: true, data: { hasRunning: true } })
      .mockResolvedValueOnce({ success: true, data: { hasRunning: true } })
      .mockResolvedValueOnce({ success: true, data: { hasRunning: false } });
    mocks.getPullRequestsRuntimeClient.mockResolvedValue({ syncChecks });

    await act(async () => {
      root.render(React.createElement(Probe));
      await flushAsyncWork();
    });

    expect(syncChecks).toHaveBeenCalledOnce();
    expect(syncChecks).toHaveBeenCalledWith(
      {
        repositoryUrl: pullRequest.repositoryUrl,
        pullRequestUrl: pullRequest.url,
        headRefOid: pullRequest.headRefOid,
      },
      { signal: expect.any(AbortSignal) }
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_RUN_POLL_INTERVAL_MS);
    });
    expect(syncChecks).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_RUN_POLL_INTERVAL_MS);
    });
    expect(syncChecks).toHaveBeenCalledTimes(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_RUN_POLL_INTERVAL_MS * 2);
    });
    expect(syncChecks).toHaveBeenCalledTimes(3);
  });

  it('cancels an in-flight refresh when the pull request view unmounts', async () => {
    let resolveInFlight:
      | ((value: { success: true; data: { hasRunning: boolean } }) => void)
      | null = null;
    const syncChecks = vi
      .fn()
      .mockResolvedValueOnce({ success: true, data: { hasRunning: true } })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveInFlight = resolve;
          })
      );
    mocks.getPullRequestsRuntimeClient.mockResolvedValue({ syncChecks });

    await act(async () => {
      root.render(React.createElement(Probe));
      await flushAsyncWork();
    });
    expect(syncChecks).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_RUN_POLL_INTERVAL_MS);
    });
    expect(syncChecks).toHaveBeenCalledTimes(2);
    const signal = syncChecks.mock.calls[1]?.[1]?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    await act(async () => root.render(null));
    expect(signal.aborted).toBe(true);

    await act(async () => {
      resolveInFlight?.({ success: true, data: { hasRunning: true } });
      await flushAsyncWork();
      await vi.advanceTimersByTimeAsync(CHECK_RUN_POLL_INTERVAL_MS);
    });

    expect(syncChecks).toHaveBeenCalledTimes(2);
  });

  it('aborts the old refresh before syncing a new head', async () => {
    let resolveOldHead: ((value: { success: true; data: { hasRunning: boolean } }) => void) | null =
      null;
    const syncChecks = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOldHead = resolve;
          })
      )
      .mockResolvedValueOnce({ success: true, data: { hasRunning: false } });
    mocks.getPullRequestsRuntimeClient.mockResolvedValue({ syncChecks });

    await act(async () => {
      root.render(React.createElement(Probe));
      await flushAsyncWork();
    });
    const oldSignal = syncChecks.mock.calls[0]?.[1]?.signal as AbortSignal;
    expect(oldSignal.aborted).toBe(false);

    const newHead = { ...pullRequest, headRefOid: 'head-2' };
    await act(async () => {
      root.render(React.createElement(Probe, { pr: newHead }));
      await flushAsyncWork();
    });

    expect(oldSignal.aborted).toBe(true);
    expect(syncChecks).toHaveBeenCalledTimes(2);
    expect(syncChecks.mock.calls[1]?.[0]).toMatchObject({ headRefOid: 'head-2' });

    await act(async () => {
      resolveOldHead?.({ success: true, data: { hasRunning: true } });
      await flushAsyncWork();
      await vi.advanceTimersByTimeAsync(CHECK_RUN_POLL_INTERVAL_MS);
    });
    expect(syncChecks).toHaveBeenCalledTimes(2);
  });

  it('pauses polling while hidden and refreshes on return', async () => {
    const syncChecks = vi
      .fn()
      .mockResolvedValueOnce({ success: true, data: { hasRunning: true } })
      .mockResolvedValueOnce({ success: true, data: { hasRunning: true } })
      .mockResolvedValueOnce({ success: true, data: { hasRunning: false } });
    mocks.getPullRequestsRuntimeClient.mockResolvedValue({ syncChecks });

    await act(async () => {
      root.render(React.createElement(Probe));
      await flushAsyncWork();
    });
    expect(syncChecks).toHaveBeenCalledOnce();

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new dom.window.Event('visibilitychange'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_RUN_POLL_INTERVAL_MS * 2);
    });
    expect(syncChecks).toHaveBeenCalledOnce();

    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    await act(async () => {
      document.dispatchEvent(new dom.window.Event('visibilitychange'));
      await flushAsyncWork();
    });
    expect(syncChecks).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_RUN_POLL_INTERVAL_MS);
    });
    expect(syncChecks).toHaveBeenCalledTimes(3);
  });

  it('keeps the current checks when a refresh fails without starting a retry loop', async () => {
    const syncChecks = vi.fn().mockResolvedValue({
      success: false,
      error: { type: 'refresh_failed', message: 'GitHub is unavailable' },
    });
    mocks.getPullRequestsRuntimeClient.mockResolvedValue({ syncChecks });

    await act(async () => {
      root.render(React.createElement(Probe));
      await flushAsyncWork();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_RUN_POLL_INTERVAL_MS * 2);
    });

    expect(syncChecks).toHaveBeenCalledOnce();
  });
});
