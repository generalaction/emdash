import { describe, expect, it, vi } from 'vitest';
import {
  registerProcessCrashLogging,
  reportChildProcessGone,
  reportRenderProcessGone,
  type ChildProcessGoneDetails,
  type ProcessCrashEventSource,
  type ProcessGoneDetails,
} from './process-crash-logging';

const APP_URL = 'app://emdash/index.html';

describe('reportRenderProcessGone', () => {
  it('reports an out-of-memory kill with the window it took down', () => {
    const report = reportRenderProcessGone({ reason: 'oom', exitCode: 0 }, APP_URL);
    expect(report).toEqual({
      message: 'Renderer process gone',
      fields: { reason: 'oom', exitCode: 0, url: APP_URL },
    });
  });

  it('reports a crash with its exit code', () => {
    expect(reportRenderProcessGone({ reason: 'crashed', exitCode: 133 }, APP_URL)?.fields).toEqual({
      reason: 'crashed',
      exitCode: 133,
      url: APP_URL,
    });
  });

  it('ignores the clean exit every window reports at shutdown', () => {
    expect(reportRenderProcessGone({ reason: 'clean-exit', exitCode: 0 }, APP_URL)).toBeNull();
  });

  it('still reports when the URL could not be read', () => {
    expect(reportRenderProcessGone({ reason: 'killed', exitCode: 9 }, undefined)?.fields).toEqual({
      reason: 'killed',
      exitCode: 9,
      url: undefined,
    });
  });
});

describe('reportChildProcessGone', () => {
  it('names the helper that died', () => {
    const details: ChildProcessGoneDetails = {
      type: 'Utility',
      reason: 'crashed',
      exitCode: 11,
      name: 'Audio Service',
      serviceName: 'audio.mojom.AudioService',
    };
    expect(reportChildProcessGone(details)).toEqual({
      message: 'Child process gone',
      fields: {
        type: 'Utility',
        reason: 'crashed',
        exitCode: 11,
        name: 'Audio Service',
        serviceName: 'audio.mojom.AudioService',
      },
    });
  });

  it('ignores the clean exit every helper reports at shutdown', () => {
    expect(reportChildProcessGone({ type: 'GPU', reason: 'clean-exit', exitCode: 0 })).toBeNull();
  });
});

describe('registerProcessCrashLogging', () => {
  function stubSource() {
    const listeners = new Map<string, (...args: never[]) => void>();
    const source: ProcessCrashEventSource = {
      on(event: string, listener: (...args: never[]) => void) {
        listeners.set(event, listener);
        return this;
      },
    } as ProcessCrashEventSource;

    return {
      source,
      renderProcessGone(details: ProcessGoneDetails, contents: { getURL(): string }) {
        (listeners.get('render-process-gone') as unknown as RenderListener)({}, contents, details);
      },
      childProcessGone(details: ChildProcessGoneDetails) {
        (listeners.get('child-process-gone') as unknown as ChildListener)({}, details);
      },
    };
  }

  type RenderListener = (
    event: unknown,
    contents: { getURL(): string },
    details: ProcessGoneDetails
  ) => void;
  type ChildListener = (event: unknown, details: ChildProcessGoneDetails) => void;

  it('logs a renderer crash as an error', () => {
    const logger = { error: vi.fn() };
    const stub = stubSource();
    registerProcessCrashLogging(stub.source, logger);

    stub.renderProcessGone({ reason: 'oom', exitCode: 0 }, { getURL: () => APP_URL });

    expect(logger.error).toHaveBeenCalledExactlyOnceWith('Renderer process gone', {
      reason: 'oom',
      exitCode: 0,
      url: APP_URL,
    });
  });

  it('logs a helper crash as an error', () => {
    const logger = { error: vi.fn() };
    const stub = stubSource();
    registerProcessCrashLogging(stub.source, logger);

    stub.childProcessGone({ type: 'GPU', reason: 'launch-failed', exitCode: 1 });

    expect(logger.error).toHaveBeenCalledExactlyOnceWith('Child process gone', {
      type: 'GPU',
      reason: 'launch-failed',
      exitCode: 1,
      name: undefined,
      serviceName: undefined,
    });
  });

  it('stays quiet through a normal shutdown', () => {
    const logger = { error: vi.fn() };
    const stub = stubSource();
    registerProcessCrashLogging(stub.source, logger);

    stub.renderProcessGone({ reason: 'clean-exit', exitCode: 0 }, { getURL: () => APP_URL });
    stub.childProcessGone({ type: 'GPU', reason: 'clean-exit', exitCode: 0 });

    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs the crash even when the dying WebContents cannot report its URL', () => {
    const logger = { error: vi.fn() };
    const stub = stubSource();
    registerProcessCrashLogging(stub.source, logger);

    stub.renderProcessGone(
      { reason: 'crashed', exitCode: 5 },
      {
        getURL: () => {
          throw new Error('Object has been destroyed');
        },
      }
    );

    expect(logger.error).toHaveBeenCalledExactlyOnceWith('Renderer process gone', {
      reason: 'crashed',
      exitCode: 5,
      url: undefined,
    });
  });
});
