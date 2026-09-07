import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROBE_FAST_INTERVAL_MS,
  PROBE_STEADY_INTERVAL_MS,
  wireTerminalUrlDetector,
  type DetectedPreviewUrl,
  type PreviewSourceClosed,
  type TerminalOutputSource,
} from './url-detector';

function fakePty(): TerminalOutputSource & {
  emitData(data: string): void;
  emitExit(): void;
} {
  const dataHandlers: Array<(data: string) => void> = [];
  const exitHandlers: Array<() => void> = [];

  return {
    onData: (handler) => dataHandlers.push(handler),
    onExit: (handler) => exitHandlers.push(handler),
    emitData(data) {
      for (const handler of dataHandlers) handler(data);
    },
    emitExit() {
      for (const handler of exitHandlers) handler();
    },
  };
}

describe('wireTerminalUrlDetector', () => {
  it('reports each localhost URL once with normalized host and path details', () => {
    const pty = fakePty();
    const detected: DetectedPreviewUrl[] = [];
    const closed: PreviewSourceClosed[] = [];

    wireTerminalUrlDetector({
      pty,
      probeLocalPorts: false,
      onDetected: (server) => {
        detected.push(server);
      },
      onSourceClosed: (event) => {
        closed.push(event);
      },
    });

    pty.emitData(
      '\x1b[32mready\x1b[0m http://localhost:3000/app?tab=1#top and http://0.0.0.0:5173/'
    );
    pty.emitData('duplicate http://localhost:3000/ignored');
    pty.emitData('later https://127.0.0.1:8443/admin');
    pty.emitExit();

    expect(detected).toEqual([
      {
        protocol: 'http:',
        host: 'localhost',
        port: 3000,
        urlPath: '/app?tab=1#top',
      },
      {
        protocol: 'http:',
        host: '127.0.0.1',
        port: 5173,
        urlPath: '/',
      },
      {
        protocol: 'https:',
        host: '127.0.0.1',
        port: 8443,
        urlPath: '/admin',
      },
    ]);
    expect(closed).toEqual([{ reason: 'pty-exit' }]);
  });

  it('trims unmatched trailing parentheses from detected preview URLs', () => {
    const pty = fakePty();
    const detected: DetectedPreviewUrl[] = [];

    wireTerminalUrlDetector({
      pty,
      probeLocalPorts: false,
      onDetected: (server) => {
        detected.push(server);
      },
    });

    pty.emitData('Local: (http://localhost:3000/)');
    pty.emitData('Balanced path: http://localhost:3001/foo(bar)');
    pty.emitData('Extra closing path: http://localhost:3002/foo(bar))');

    expect(detected).toEqual([
      {
        protocol: 'http:',
        host: 'localhost',
        port: 3000,
        urlPath: '/',
      },
      {
        protocol: 'http:',
        host: 'localhost',
        port: 3001,
        urlPath: '/foo(bar)',
      },
      {
        protocol: 'http:',
        host: 'localhost',
        port: 3002,
        urlPath: '/foo(bar)',
      },
    ]);
  });
});

describe('adaptive probe cadence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function probeHarness(responses: boolean[]) {
    const pty = fakePty();
    const closed: PreviewSourceClosed[] = [];
    const probeTimes: number[] = [];
    const start = Date.now();

    const stop = wireTerminalUrlDetector({
      pty,
      portProbe: async () => {
        probeTimes.push(Date.now() - start);
        return responses.length > 0 ? responses.shift()! : true;
      },
      onDetected: () => {},
      onSourceClosed: (event) => {
        closed.push(event);
      },
    });

    pty.emitData('ready http://localhost:3000/');
    return { pty, closed, probeTimes, stop };
  }

  it('probes at the fast cadence until the first success, then relaxes to steady-state', async () => {
    // Server still starting: one failed probe, then up.
    const { probeTimes, closed, stop } = probeHarness([false, true, true, true]);

    await vi.advanceTimersByTimeAsync(PROBE_FAST_INTERVAL_MS);
    expect(probeTimes).toEqual([0, PROBE_FAST_INTERVAL_MS]);

    // After the first success, nothing fires for the rest of the steady interval…
    await vi.advanceTimersByTimeAsync(PROBE_STEADY_INTERVAL_MS - 1);
    expect(probeTimes).toHaveLength(2);

    // …then the steady-state probe lands.
    await vi.advanceTimersByTimeAsync(1);
    expect(probeTimes).toEqual([
      0,
      PROBE_FAST_INTERVAL_MS,
      PROBE_FAST_INTERVAL_MS + PROBE_STEADY_INTERVAL_MS,
    ]);
    expect(closed).toEqual([]);
    stop();
  });

  it('a server that is up immediately is confirmed by the instant first probe', async () => {
    const { probeTimes, stop } = probeHarness([true, true]);

    await vi.advanceTimersByTimeAsync(0);
    expect(probeTimes).toEqual([0]);

    await vi.advanceTimersByTimeAsync(PROBE_STEADY_INTERVAL_MS);
    expect(probeTimes).toEqual([0, PROBE_STEADY_INTERVAL_MS]);
    stop();
  });

  it('snaps back to the fast cadence on a failure so the closing failure lands ~1 s later', async () => {
    // Healthy at 0 and 15 s, dies before 30 s: fail at 30 s, closing fail at 31 s.
    const { probeTimes, closed, stop } = probeHarness([true, true, false, false]);

    await vi.advanceTimersByTimeAsync(2 * PROBE_STEADY_INTERVAL_MS + PROBE_FAST_INTERVAL_MS);
    expect(probeTimes).toEqual([
      0,
      PROBE_STEADY_INTERVAL_MS,
      2 * PROBE_STEADY_INTERVAL_MS,
      2 * PROBE_STEADY_INTERVAL_MS + PROBE_FAST_INTERVAL_MS,
    ]);
    expect(closed).toEqual([
      {
        reason: 'local-probe-failed',
        server: { protocol: 'http:', host: 'localhost', port: 3000, urlPath: '/' },
      },
    ]);
    stop();
  });

  it('recovers to the steady cadence after a transient single failure', async () => {
    const { probeTimes, closed, stop } = probeHarness([true, false, true, true]);

    await vi.advanceTimersByTimeAsync(PROBE_STEADY_INTERVAL_MS + PROBE_FAST_INTERVAL_MS);
    expect(probeTimes).toEqual([
      0,
      PROBE_STEADY_INTERVAL_MS,
      PROBE_STEADY_INTERVAL_MS + PROBE_FAST_INTERVAL_MS,
    ]);

    await vi.advanceTimersByTimeAsync(PROBE_STEADY_INTERVAL_MS);
    expect(probeTimes).toHaveLength(4);
    expect(probeTimes[3]).toBe(
      PROBE_STEADY_INTERVAL_MS + PROBE_FAST_INTERVAL_MS + PROBE_STEADY_INTERVAL_MS
    );
    expect(closed).toEqual([]);
    stop();
  });

  it('does not re-detect a closed URL from retained output', async () => {
    const pty = fakePty();
    const detected: DetectedPreviewUrl[] = [];
    const closed: PreviewSourceClosed[] = [];
    const stop = wireTerminalUrlDetector({
      pty,
      portProbe: async () => false,
      onDetected: (server) => {
        detected.push(server);
      },
      onSourceClosed: (event) => {
        closed.push(event);
      },
    });

    pty.emitData('ready http://localhost:3000/');
    await vi.advanceTimersByTimeAsync(PROBE_FAST_INTERVAL_MS);
    expect(detected).toHaveLength(1);
    expect(closed).toEqual([
      {
        reason: 'local-probe-failed',
        server: { protocol: 'http:', host: 'localhost', port: 3000, urlPath: '/' },
      },
    ]);

    pty.emitData('$ ');
    expect(detected).toHaveLength(1);

    pty.emitData('ready http://localhost:3000/');
    expect(detected).toHaveLength(2);
    stop();
  });

  it('stops probing on pty exit', async () => {
    const { pty, probeTimes, closed } = probeHarness([true, true, true]);

    await vi.advanceTimersByTimeAsync(PROBE_STEADY_INTERVAL_MS);
    expect(probeTimes).toHaveLength(2);

    pty.emitExit();
    await vi.advanceTimersByTimeAsync(10 * PROBE_STEADY_INTERVAL_MS);
    expect(probeTimes).toHaveLength(2);
    expect(closed).toEqual([{ reason: 'pty-exit' }]);
  });
});
