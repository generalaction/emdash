import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  readFailures: new Set<string>(),
  writeFailures: new Set<string>(),
  transportError: false,
  captureHandler: undefined as
    | ((event: { event: string; timestamp?: Date; uuid?: string }) => Promise<void>)
    | undefined,
  env: {
    build: {
      VITE_BUILD: 'production',
      VITE_POSTHOG_KEY: 'phc_test',
      VITE_POSTHOG_HOST: 'https://posthog.example.com',
    },
    dev: {},
    runtime: {} as { TELEMETRY_ENABLED?: string },
  },
  clients: [] as Array<{
    captureImmediate: ReturnType<typeof vi.fn>;
    captureExceptionImmediate: ReturnType<typeof vi.fn>;
    disable: ReturnType<typeof vi.fn>;
    enable: ReturnType<typeof vi.fn>;
    getAllFlags: ReturnType<typeof vi.fn>;
    identifyImmediate: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    _shutdown: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('electron', () => ({
  app: {
    getVersion: () => '1.2.3',
    isPackaged: true,
  },
}));

vi.mock('@main/lib/env', () => ({
  env: mocks.env,
}));

vi.mock('@main/db/kv', () => ({
  KV: class {
    async get(key: string) {
      return mocks.store.get(key) ?? null;
    }

    async getOrThrow(key: string) {
      if (mocks.readFailures.has(key)) throw new Error('Invalid stored value');
      return mocks.store.get(key) ?? null;
    }

    async set(key: string, value: unknown) {
      mocks.store.set(key, value);
    }

    async setOrThrow(key: string, value: unknown) {
      if (mocks.writeFailures.has(key)) throw new Error('Write failed');
      mocks.store.set(key, value);
    }

    async del(key: string) {
      mocks.store.delete(key);
    }
  },
}));

vi.mock('posthog-node', () => ({
  PostHog: class {
    private errorHandlers = new Set<() => void>();
    captureImmediate = vi.fn(async (event: { event: string; timestamp?: Date; uuid?: string }) => {
      await (mocks.captureHandler ? mocks.captureHandler(event) : Promise.resolve());
      if (mocks.transportError) {
        for (const handler of this.errorHandlers) handler();
      }
    });
    captureExceptionImmediate = vi.fn().mockResolvedValue(undefined);
    disable = vi.fn().mockResolvedValue(undefined);
    enable = vi.fn().mockResolvedValue(undefined);
    getAllFlags = vi.fn().mockResolvedValue({});
    identifyImmediate = vi.fn().mockResolvedValue(undefined);
    on = vi.fn((event: string, handler: () => void) => {
      if (event === 'error') this.errorHandlers.add(handler);
      return () => this.errorHandlers.delete(handler);
    });
    _shutdown = vi.fn().mockResolvedValue(undefined);

    constructor() {
      mocks.clients.push(this as (typeof mocks.clients)[number]);
    }
  },
}));

import { TelemetryService } from './telemetry';

describe('TelemetryService', () => {
  beforeEach(() => {
    mocks.store.clear();
    mocks.readFailures.clear();
    mocks.writeFailures.clear();
    mocks.clients.length = 0;
    mocks.captureHandler = undefined;
    mocks.transportError = false;
    delete mocks.env.runtime.TELEMETRY_ENABLED;
  });

  it('does not initialize PostHog when telemetry is disabled by the environment', async () => {
    mocks.env.runtime.TELEMETRY_ENABLED = 'false';

    const service = new TelemetryService(false);
    await service.initialize();

    expect(mocks.clients).toHaveLength(0);
    expect(service.getTelemetryStatus()).toMatchObject({
      enabled: false,
      envDisabled: true,
    });
  });

  it('does not initialize PostHog and clears stale sessions after opt-out', async () => {
    mocks.store.set('enabled', 'false');
    mocks.store.set('sessionState', {
      sessionId: 'disabled-session',
      lastHeartbeatTs: new Date().toISOString(),
    });

    const service = new TelemetryService(false);
    await service.initialize();

    expect(mocks.clients).toHaveLength(0);
    expect(mocks.store.has('sessionState')).toBe(false);
    expect(service.getTelemetryStatus().enabled).toBe(false);
  });

  it('fails closed when stored telemetry consent cannot be parsed', async () => {
    mocks.readFailures.add('enabled');

    const service = new TelemetryService(false);
    await service.initialize();

    expect(mocks.clients).toHaveLength(0);
    expect(service.getTelemetryStatus().enabled).toBe(false);
  });

  it('records session state immediately and removes it when telemetry is disabled', async () => {
    const service = new TelemetryService(false);
    await service.initialize();

    expect(mocks.store.get('sessionState')).toMatchObject({
      active: { sessionId: service.getTelemetryStatus().session_id },
      pendingRecoveries: [],
    });

    service.capture('app_window_focused');
    await service.setTelemetryEnabledViaUser(false);

    expect(mocks.store.has('sessionState')).toBe(false);
    expect(mocks.clients[0]?.disable).toHaveBeenCalledOnce();
    expect(
      mocks.clients[0]?.captureImmediate.mock.calls.some(
        ([event]) => event.event === 'app_window_focused'
      )
    ).toBe(false);
  });

  it('keeps runtime telemetry disabled when persisting opt-out fails', async () => {
    const service = new TelemetryService(false);
    await service.initialize();
    mocks.writeFailures.add('enabled');

    await expect(service.setTelemetryEnabledViaUser(false)).rejects.toThrow('Write failed');
    service.capture('app_window_focused');
    await Promise.resolve();

    expect(service.getTelemetryStatus().enabled).toBe(false);
    expect(mocks.clients[0]?.disable).toHaveBeenCalledOnce();
    expect(
      mocks.clients[0]?.captureImmediate.mock.calls.some(
        ([event]) => event.event === 'app_window_focused'
      )
    ).toBe(false);
  });

  it('keeps runtime telemetry disabled when arming an opted-in session fails', async () => {
    mocks.store.set('enabled', 'false');
    const service = new TelemetryService(false);
    await service.initialize();
    mocks.writeFailures.add('sessionState');

    await expect(service.setTelemetryEnabledViaUser(true)).rejects.toThrow('Write failed');

    expect(service.getTelemetryStatus().enabled).toBe(false);
    expect(mocks.clients[0]?.disable).toHaveBeenCalledOnce();
  });

  it('preserves an existing recovery when the current session marker cannot be written', async () => {
    const previousState = {
      active: {
        sessionId: '72ce17d2-037a-4b53-bf84-01d680f2dbb7',
        lastHeartbeatTs: '2026-07-20T10:00:00.000Z',
      },
      pendingRecoveries: [],
    };
    mocks.store.set('sessionState', previousState);
    mocks.writeFailures.add('sessionState');

    const service = new TelemetryService(false);
    await service.initialize();

    expect(mocks.store.get('sessionState')).toEqual(previousState);
    expect(mocks.clients).toHaveLength(0);
    expect(service.getTelemetryStatus().enabled).toBe(false);
  });

  it('uses PostHog exception capture with redacted error data', async () => {
    const service = new TelemetryService(false);
    await service.initialize();

    const error = new Error('token: ghp_123456');
    await service.captureExceptionImmediate(error, {
      mechanism: 'uncaught_exception',
      process_type: 'main',
    });

    const capture = mocks.clients[0]?.captureExceptionImmediate;
    expect(capture).toHaveBeenCalledOnce();
    const [reportedError, distinctId, properties] = capture!.mock.calls[0]!;
    expect(reportedError.message).not.toContain('ghp_123456');
    expect(reportedError.stack).not.toContain('ghp_123456');
    expect(distinctId).toBe(service.getInstanceId());
    expect(properties).toMatchObject({
      mechanism: 'uncaught_exception',
      process_type: 'main',
    });

    await service.dispose();
    expect(mocks.clients[0]?._shutdown).toHaveBeenCalledWith(1_000);
  });

  it('persists the current session and a stable recovery ID before reporting an unclean exit', async () => {
    const previousSession = {
      sessionId: '72ce17d2-037a-4b53-bf84-01d680f2dbb7',
      lastHeartbeatTs: '2026-07-20T10:00:00.000Z',
    };
    mocks.store.set('sessionState', previousSession);
    let finishRecovery: (() => void) | undefined;
    mocks.captureHandler = ({ event }) =>
      event === 'app_closed'
        ? new Promise<void>((resolve) => {
            finishRecovery = resolve;
          })
        : Promise.resolve();

    const service = new TelemetryService(false);
    const initializing = service.initialize();
    await vi.waitFor(() => expect(finishRecovery).toBeTypeOf('function'));

    const persisted = mocks.store.get('sessionState') as {
      active: { sessionId: string };
      pendingRecoveries: Array<{ eventId: string; sessionId: string }>;
    };
    expect(persisted.active.sessionId).toBe(service.getTelemetryStatus().session_id);
    expect(persisted.pendingRecoveries).toHaveLength(1);
    expect(persisted.pendingRecoveries[0]).toMatchObject({ sessionId: previousSession.sessionId });
    const recoveryEventId = persisted.pendingRecoveries[0]!.eventId;

    finishRecovery!();
    await initializing;
    await vi.waitFor(() => {
      expect(
        (mocks.store.get('sessionState') as { pendingRecoveries: unknown[] }).pendingRecoveries
      ).toHaveLength(0);
    });
    expect(mocks.clients[0]?.captureImmediate).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'app_closed',
        uuid: recoveryEventId,
        timestamp: new Date(previousSession.lastHeartbeatTs),
        properties: expect.objectContaining({ was_unclean_exit: true }),
      })
    );

    mocks.captureHandler = undefined;
    await service.dispose();
  });

  it('retains a pending recovery when the PostHog SDK reports a transport error', async () => {
    const previousSession = {
      sessionId: '72ce17d2-037a-4b53-bf84-01d680f2dbb7',
      lastHeartbeatTs: '2026-07-20T10:00:00.000Z',
    };
    mocks.store.set('sessionState', previousSession);
    mocks.transportError = true;

    const service = new TelemetryService(false);
    await service.initialize();

    expect(mocks.store.get('sessionState')).toMatchObject({
      pendingRecoveries: [
        {
          eventId: previousSession.sessionId,
          sessionId: previousSession.sessionId,
        },
      ],
    });

    mocks.transportError = false;
    await service.dispose();
  });

  it('removes a pending recovery with an invalid timestamp', async () => {
    mocks.store.set('sessionState', {
      active: null,
      pendingRecoveries: [
        {
          eventId: '72ce17d2-037a-4b53-bf84-01d680f2dbb7',
          sessionId: '72ce17d2-037a-4b53-bf84-01d680f2dbb7',
          lastHeartbeatTs: 'not-a-timestamp',
        },
      ],
    });

    const service = new TelemetryService(false);
    await service.initialize();

    expect(mocks.store.get('sessionState')).toMatchObject({ pendingRecoveries: [] });
    expect(
      mocks.clients[0]?.captureImmediate.mock.calls.some(([event]) => event.event === 'app_closed')
    ).toBe(false);

    await service.dispose();
  });

  it('retains the active session when the clean close event fails', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-07-20T10:00:00.000Z'));
      const service = new TelemetryService(false);
      await service.initialize();
      const sessionId = service.getTelemetryStatus().session_id;
      let closeEvent: { timestamp?: Date } | undefined;
      let finishClose: (() => void) | undefined;
      mocks.captureHandler = (event) => {
        if (event.event !== 'app_closed') return Promise.resolve();
        closeEvent = event;
        return new Promise<void>((resolve) => {
          finishClose = resolve;
        });
      };
      mocks.transportError = true;

      const disposing = service.dispose();
      await vi.advanceTimersByTimeAsync(0);
      expect(finishClose).toBeTypeOf('function');
      await vi.advanceTimersByTimeAsync(60_000);
      finishClose!();
      await disposing;

      expect(mocks.store.get('sessionState')).toMatchObject({
        active: null,
        pendingRecoveries: [
          {
            eventId: sessionId,
            sessionId,
            lastHeartbeatTs: closeEvent?.timestamp?.toISOString(),
          },
        ],
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
