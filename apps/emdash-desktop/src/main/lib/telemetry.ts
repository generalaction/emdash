import { randomUUID } from 'node:crypto';
import type { IDisposable, IInitializable } from '@emdash/shared';
import { redactAll } from '@emdash/shared/logger';
import { app } from 'electron';
import { PostHog } from 'posthog-node';
import { KV } from '@main/db/kv';
import { env as appEnv } from '@main/lib/env';
import type { TelemetryEnvelope, TelemetryEvent, TelemetryProperties } from '@shared/telemetry';

interface InitOptions {
  installSource?: string;
}

type SessionSnapshot = {
  sessionId: string;
  lastHeartbeatTs: string;
};

type PendingRecovery = SessionSnapshot & {
  eventId: string;
};

type PersistedSessionState = {
  active: SessionSnapshot | null;
  pendingRecoveries: PendingRecovery[];
};

type TelemetryKVSchema = {
  instanceId: string;
  enabled: string;
  lastActiveDate: string;
  sessionState: PersistedSessionState | SessionSnapshot;
  lastSessionId: string;
  lastHeartbeatTs: string;
};

const LIB_NAME = 'emdash';
const isViteDevBuild = import.meta.env.DEV;
const MAX_EVENT_TS_MS = 9_999_999_999_999;
const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_GENERIC_NUMBER = 1_000_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isSessionSnapshot(value: unknown): value is SessionSnapshot {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.sessionId === 'string' && typeof record.lastHeartbeatTs === 'string';
}

function isPersistedSessionState(value: unknown): value is PersistedSessionState {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    (record.active === null || isSessionSnapshot(record.active)) &&
    Array.isArray(record.pendingRecoveries)
  );
}

function recoveryEventId(sessionId: string): string {
  return UUID_PATTERN.test(sessionId) ? sessionId : randomUUID();
}

export class TelemetryService implements IInitializable, IDisposable {
  private enabled = true;
  private apiKey: string | undefined;
  private host: string | undefined;
  private instanceId: string | undefined;
  private installSource: string | undefined;
  private userOptOut: boolean | undefined;
  private sessionId: string | undefined;
  private lastActiveDate: string | undefined;
  private cachedGithubUsername: string | null = null;
  private cachedAccountId: string | null = null;
  private cachedEmail: string | null = null;
  private cachedFeatureFlags: Record<string, boolean> = {};
  private heartbeatInterval: ReturnType<typeof setInterval> | undefined;
  private heartbeatGeneration = 0;
  private sessionState: PersistedSessionState | undefined;
  private sessionWriteQueue = Promise.resolve();
  private consentGeneration = 0;
  private lifecycle: 'active' | 'disposing' | 'disposed' = 'active';
  private requestController = new AbortController();
  private client: PostHog | undefined;
  private readonly pendingRequests = new Set<Promise<void>>();
  private readonly kv = new KV<TelemetryKVSchema>('telemetry');

  constructor(private readonly devBuild = isViteDevBuild) {}

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private isEnabled(): boolean {
    return (
      !this.devBuild &&
      this.lifecycle === 'active' &&
      this.enabled === true &&
      this.userOptOut !== true &&
      !!this.apiKey &&
      !!this.host &&
      typeof this.instanceId === 'string' &&
      this.instanceId.length > 0
    );
  }

  private async ensureClient(): Promise<PostHog | undefined> {
    if (!this.isEnabled()) return undefined;
    if (!this.client) {
      this.client = new PostHog(this.apiKey!, {
        host: this.host,
        disableGeoip: true,
        fetchRetryCount: 0,
        flushInterval: 0,
        isServer: false,
        preloadFeatureFlags: false,
        requestTimeout: 2_000,
        fetch: (url, options) =>
          fetch(url, {
            ...options,
            signal: options.signal
              ? AbortSignal.any([options.signal, this.requestController.signal])
              : this.requestController.signal,
          }),
      });
    }
    return this.client;
  }

  private trackRequest(request: Promise<unknown>): Promise<void> {
    const tracked = request.then(
      () => undefined,
      () => undefined
    );
    this.pendingRequests.add(tracked);
    void tracked.finally(() => this.pendingRequests.delete(tracked));
    return tracked;
  }

  private async flushPendingRequests(timeoutMs: number): Promise<void> {
    const pending = [...this.pendingRequests];
    if (pending.length === 0) return;
    await Promise.race([
      Promise.allSettled(pending).then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }

  private getVersionSafe(): string {
    try {
      return app.getVersion();
    } catch {
      return 'unknown';
    }
  }

  private getBaseProps() {
    return {
      schema_version: 1,
      app_version: this.getVersionSafe(),
      build_variant: appEnv.build.VITE_BUILD,
      source: 'desktop_app',
      electron_version: process.versions.electron,
      platform: process.platform,
      arch: process.arch,
      is_dev: !app.isPackaged,
      install_source: this.installSource ?? (app.isPackaged ? 'dmg' : 'dev'),
      $lib: LIB_NAME,
      ...(this.cachedGithubUsername ? { github_username: this.cachedGithubUsername } : {}),
      ...(this.cachedAccountId ? { account_id: this.cachedAccountId } : {}),
    };
  }

  /**
   * Sanitize event properties to prevent PII leakage.
   * Simple allowlist approach: only allow safe property names and primitive types.
   */
  private sanitizeEventAndProps(_event: string, props: Record<string, unknown> | undefined) {
    const sanitized: Record<string, unknown> = {};

    const allowedProps = new Set([
      'active_view',
      'active_main_panel',
      'active_right_panel',
      'focused_region',
      'view',
      'from_view',
      'to_view',
      'main_panel',
      'right_panel',
      'trigger',
      'event_ts_ms',
      'session_id',
      'project_id',
      'task_id',
      'conversation_id',
      'side',
      'region',
      'panel',
      'from_status',
      'to_status',
      'has_issue',
      'is_first_in_task',
      'is_draft',
      'exit_code',
      'setting',
      'severity',
      'component',
      'action',
      'user_action',
      'operation',
      'endpoint',
      'session_errors',
      'error_timestamp',
      'schema_version',
      'provider',
      'source',
      'has_initial_prompt',
      'state',
      'success',
      'error_type',
      'github_username',
      'account_id',
      'enabled',
      'app',
      'applied_migrations_bucket',
      'recovered',
      'date',
      'timezone',
      'scope',
      'strategy',
      'conflicts',
      'count',
      'terminal_id',
      'was_unclean_exit',
      'type',
      'status',
      'automation_id',
      'trigger_kind',
      'duration_ms',
      'error_step',
      'error_code',
      'process_type',
      'mechanism',
      'reason',
      'component_stack',
    ]);
    const longTextProps = new Set(['component_stack']);

    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (!allowedProps.has(key)) continue;

        if (typeof value === 'string') {
          const maxLength = longTextProps.has(key) ? 4_000 : 100;
          sanitized[key] = redactAll(value).trim().slice(0, maxLength);
        } else if (typeof value === 'number') {
          if (key === 'event_ts_ms') {
            sanitized[key] = Math.max(0, Math.min(Math.trunc(value), MAX_EVENT_TS_MS));
          } else if (key === 'duration_ms') {
            sanitized[key] = Math.max(0, Math.min(Math.trunc(value), MAX_DURATION_MS));
          } else {
            sanitized[key] = Math.max(-MAX_GENERIC_NUMBER, Math.min(value, MAX_GENERIC_NUMBER));
          }
        } else if (typeof value === 'boolean') {
          sanitized[key] = value;
        } else if (value === null) {
          sanitized[key] = null;
        }
      }
    }

    return sanitized;
  }

  private normalizeHost(h: string | undefined): string | undefined {
    if (!h) return undefined;
    let s = String(h).trim();
    if (!/^https?:\/\//i.test(s)) {
      s = 'https://' + s;
    }
    return s.replace(/\/+$/, '');
  }

  // ---------------------------------------------------------------------------
  // PostHog transport
  // ---------------------------------------------------------------------------

  private async posthogCapture(
    event: TelemetryEvent,
    properties?: Record<string, unknown>,
    delivery?: { uuid: string; timestamp: Date; confirmTransport: boolean }
  ): Promise<boolean> {
    if (!this.isEnabled()) return false;
    const consentGeneration = this.consentGeneration;
    try {
      const client = await this.ensureClient();
      if (
        !client ||
        !this.instanceId ||
        consentGeneration !== this.consentGeneration ||
        !this.isEnabled()
      )
        return false;
      let transportFailed = false;
      const unsubscribe = delivery?.confirmTransport
        ? client.on('error', () => {
            transportFailed = true;
          })
        : undefined;
      try {
        await client.captureImmediate({
          distinctId: this.instanceId,
          event,
          uuid: delivery?.uuid,
          timestamp: delivery?.timestamp,
          properties: {
            ...this.getBaseProps(),
            ...this.sanitizeEventAndProps(event, properties),
          },
        });
        return !transportFailed;
      } finally {
        unsubscribe?.();
      }
    } catch {
      // swallow errors; telemetry must never crash the app
      return false;
    }
  }

  private async posthogIdentify(username: string, email?: string): Promise<void> {
    if (!this.isEnabled() || !username) return;
    const consentGeneration = this.consentGeneration;
    try {
      const client = await this.ensureClient();
      if (
        !client ||
        !this.instanceId ||
        consentGeneration !== this.consentGeneration ||
        !this.isEnabled()
      )
        return;
      await client.identifyImmediate({
        distinctId: this.instanceId,
        properties: {
          ...(email ? { email } : {}),
          ...this.getBaseProps(),
        },
      });
    } catch {
      // swallow errors; telemetry must never crash the app
    }
  }

  private async posthogDecide(): Promise<void> {
    if (!this.isEnabled() || !this.instanceId) return;
    const consentGeneration = this.consentGeneration;
    try {
      const client = await this.ensureClient();
      if (!client || consentGeneration !== this.consentGeneration || !this.isEnabled()) return;
      const flags = await client.getAllFlags(this.instanceId, {
        personProperties: {
          ...(this.cachedGithubUsername ? { github_username: this.cachedGithubUsername } : {}),
          ...(this.cachedAccountId ? { account_id: this.cachedAccountId } : {}),
          ...(this.cachedEmail ? { email: this.cachedEmail } : {}),
        },
      });
      const parsed: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(flags)) {
        if (typeof value === 'boolean') {
          parsed[key] = value;
        } else if (value === 'true' || value === 'false') {
          parsed[key] = value === 'true';
        }
      }
      this.cachedFeatureFlags = parsed;
    } catch {
      // swallow errors; telemetry must never crash the app
    }
  }

  // ---------------------------------------------------------------------------
  // Daily active user
  // ---------------------------------------------------------------------------

  private async checkDailyActiveUser(): Promise<void> {
    if (!this.isEnabled()) return;
    try {
      const today = new Date().toISOString().split('T')[0]!;
      if (this.lastActiveDate === today) return;

      void this.trackRequest(
        this.posthogCapture('daily_active_user', {
          date: today,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
        })
      );

      this.lastActiveDate = today;
      void this.kv.set('lastActiveDate', today);
    } catch {
      // Never let telemetry errors crash the app
    }
  }

  private async clearSessionState(): Promise<void> {
    await this.disarmSessionState();
    await Promise.all([
      this.kv.del('sessionState'),
      this.kv.del('lastSessionId'),
      this.kv.del('lastHeartbeatTs'),
    ]);
  }

  private async disarmSessionState(): Promise<void> {
    this.heartbeatGeneration += 1;
    if (this.heartbeatInterval !== undefined) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
    this.sessionState = undefined;
    await this.sessionWriteQueue.catch(() => undefined);
  }

  private async closeSessionState(): Promise<void> {
    const generation = ++this.heartbeatGeneration;
    if (this.heartbeatInterval !== undefined) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
    await this.sessionWriteQueue.catch(() => undefined);
    if (this.sessionState?.pendingRecoveries.length) {
      this.sessionState.active = null;
      await this.writeSessionState(generation);
    } else {
      await this.kv.del('sessionState');
    }
    this.sessionState = undefined;
    await Promise.all([this.kv.del('lastSessionId'), this.kv.del('lastHeartbeatTs')]);
  }

  private writeSessionState(generation: number): Promise<void> {
    this.sessionWriteQueue = this.sessionWriteQueue
      .catch(() => undefined)
      .then(async () => {
        if (generation !== this.heartbeatGeneration || !this.sessionState) return;
        await this.kv.setOrThrow('sessionState', this.sessionState);
      });
    return this.sessionWriteQueue;
  }

  private async armSessionState(pendingRecoveries: PendingRecovery[] = []): Promise<void> {
    if (!this.isEnabled() || !this.sessionId) return;
    if (this.heartbeatInterval !== undefined) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
    const generation = ++this.heartbeatGeneration;
    this.sessionState = {
      active: {
        sessionId: this.sessionId,
        lastHeartbeatTs: new Date().toISOString(),
      },
      pendingRecoveries,
    };
    const writeHeartbeat = async () => {
      if (
        generation !== this.heartbeatGeneration ||
        !this.isEnabled() ||
        !this.sessionState?.active
      )
        return;
      this.sessionState.active.lastHeartbeatTs = new Date().toISOString();
      await this.writeSessionState(generation);
      if (generation !== this.heartbeatGeneration || !this.isEnabled()) {
        await this.kv.del('sessionState');
      }
    };

    await writeHeartbeat();
    if (generation !== this.heartbeatGeneration || !this.isEnabled()) return;
    this.heartbeatInterval = setInterval(() => {
      void writeHeartbeat().catch(() => undefined);
    }, 60_000);
  }

  private async reportPendingRecoveries(generation: number): Promise<void> {
    const pendingRecoveries = [...(this.sessionState?.pendingRecoveries ?? [])];
    for (const recovery of pendingRecoveries) {
      const lastHeartbeatMs = Date.parse(recovery.lastHeartbeatTs);
      if (Number.isNaN(lastHeartbeatMs)) {
        await this.removePendingRecovery(recovery.eventId, generation);
        continue;
      }
      const sent = await this.posthogCapture(
        'app_closed',
        {
          was_unclean_exit: true,
          event_ts_ms: lastHeartbeatMs,
          session_id: recovery.sessionId,
        },
        {
          uuid: recovery.eventId,
          timestamp: new Date(recovery.lastHeartbeatTs),
          confirmTransport: true,
        }
      );
      if (
        !sent ||
        generation !== this.heartbeatGeneration ||
        !this.sessionState ||
        !this.isEnabled()
      )
        continue;
      await this.removePendingRecovery(recovery.eventId, generation);
    }
  }

  private async removePendingRecovery(eventId: string, generation: number): Promise<void> {
    if (generation !== this.heartbeatGeneration || !this.sessionState || !this.isEnabled()) return;
    this.sessionState.pendingRecoveries = this.sessionState.pendingRecoveries.filter(
      (recovery) => recovery.eventId !== eventId
    );
    await this.writeSessionState(generation);
  }

  private sanitizeError(error: Error | unknown): Error {
    const source = error instanceof Error ? error : new Error(String(error));
    const sanitized = new Error(redactAll(source.message || 'Unknown error').slice(0, 2_000));
    sanitized.name = redactAll(source.name || 'Error').slice(0, 100);
    sanitized.stack = redactAll(source.stack || `${sanitized.name}: ${sanitized.message}`).slice(
      0,
      10_000
    );
    return sanitized;
  }

  private async posthogCaptureException(
    error: Error | unknown,
    additionalProperties?: Record<string, unknown>
  ): Promise<void> {
    if (!this.isEnabled()) return;
    const consentGeneration = this.consentGeneration;
    try {
      const client = await this.ensureClient();
      if (
        !client ||
        !this.instanceId ||
        consentGeneration !== this.consentGeneration ||
        !this.isEnabled()
      )
        return;
      await client.captureExceptionImmediate(this.sanitizeError(error), this.instanceId, {
        ...this.getBaseProps(),
        ...this.sanitizeEventAndProps('$exception', additionalProperties),
        event_ts_ms: Date.now(),
        session_id: this.sessionId,
      });
    } catch {
      // swallow errors; telemetry must never crash the app
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async initialize(options?: InitOptions): Promise<void> {
    const enabledEnv = (appEnv.runtime.TELEMETRY_ENABLED ?? 'true').toLowerCase();
    this.enabled =
      !this.devBuild && enabledEnv !== 'false' && enabledEnv !== '0' && enabledEnv !== 'no';
    // build value wins (prod); dev fallback used locally without VITE_ vars set
    this.apiKey = appEnv.build.VITE_POSTHOG_KEY ?? appEnv.dev.POSTHOG_PROJECT_API_KEY;
    this.host = this.normalizeHost(appEnv.build.VITE_POSTHOG_HOST ?? appEnv.dev.POSTHOG_HOST);
    this.installSource = options?.installSource ?? appEnv.runtime.INSTALL_SOURCE;
    this.sessionId = randomUUID();

    // Load persisted state from SQLite KV (all reads are non-blocking best-effort)
    let storedInstanceId: string | null = null;
    let storedEnabled: string | null = null;
    let storedActiveDate: string | null = null;
    let storedSessionState: TelemetryKVSchema['sessionState'] | null = null;
    let storedLastSessionId: string | null = null;
    let storedLastHeartbeatTs: string | null = null;
    let consentReadFailed = false;
    try {
      [
        storedInstanceId,
        storedEnabled,
        storedActiveDate,
        storedSessionState,
        storedLastSessionId,
        storedLastHeartbeatTs,
      ] = await Promise.all([
        this.kv.get('instanceId'),
        this.kv.getOrThrow('enabled'),
        this.kv.get('lastActiveDate'),
        this.kv.get('sessionState'),
        this.kv.get('lastSessionId'),
        this.kv.get('lastHeartbeatTs'),
      ]);
    } catch {
      // Consent cannot be established safely when its store is unavailable.
      consentReadFailed = true;
    }
    if (storedEnabled !== null && storedEnabled !== 'true' && storedEnabled !== 'false') {
      consentReadFailed = true;
    }

    this.instanceId = storedInstanceId ?? randomUUID();
    if (!storedInstanceId) {
      await this.kv.set('instanceId', this.instanceId);
    }

    this.userOptOut = consentReadFailed || storedEnabled === 'false' ? true : undefined;
    this.lastActiveDate = storedActiveDate ?? undefined;

    if (!this.isEnabled()) {
      await this.clearSessionState();
      return;
    }

    const pendingRecoveries = new Map<string, PendingRecovery>();
    if (isPersistedSessionState(storedSessionState)) {
      for (const recovery of storedSessionState.pendingRecoveries) {
        if (isSessionSnapshot(recovery) && typeof recovery.eventId === 'string') {
          pendingRecoveries.set(recovery.sessionId, recovery);
        }
      }
      if (
        storedSessionState.active &&
        !pendingRecoveries.has(storedSessionState.active.sessionId)
      ) {
        pendingRecoveries.set(storedSessionState.active.sessionId, {
          ...storedSessionState.active,
          eventId: recoveryEventId(storedSessionState.active.sessionId),
        });
      }
    } else if (isSessionSnapshot(storedSessionState)) {
      pendingRecoveries.set(storedSessionState.sessionId, {
        ...storedSessionState,
        eventId: recoveryEventId(storedSessionState.sessionId),
      });
    }
    if (
      storedLastSessionId &&
      storedLastHeartbeatTs &&
      !pendingRecoveries.has(storedLastSessionId)
    ) {
      pendingRecoveries.set(storedLastSessionId, {
        sessionId: storedLastSessionId,
        lastHeartbeatTs: storedLastHeartbeatTs,
        eventId: recoveryEventId(storedLastSessionId),
      });
    }

    try {
      await this.armSessionState([...pendingRecoveries.values()]);
    } catch {
      this.userOptOut = true;
      await this.client?.disable();
      await this.disarmSessionState();
      return;
    }
    await Promise.all([this.kv.del('lastSessionId'), this.kv.del('lastHeartbeatTs')]);
    await this.ensureClient();
    const heartbeatGeneration = this.heartbeatGeneration;
    await this.trackRequest(this.reportPendingRecoveries(heartbeatGeneration));

    void this.trackRequest(this.posthogCapture('app_started'));
    void this.checkDailyActiveUser();
  }

  async dispose(): Promise<void> {
    if (this.lifecycle !== 'active') return;
    const closeGeneration = ++this.heartbeatGeneration;
    if (this.heartbeatInterval !== undefined) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
    await this.sessionWriteQueue.catch(() => undefined);
    const closeTimestamp = new Date();
    const activeSession = this.sessionState?.active;
    let closeStatePersisted = !activeSession;
    if (activeSession) {
      activeSession.lastHeartbeatTs = closeTimestamp.toISOString();
      closeStatePersisted = await this.writeSessionState(closeGeneration).then(
        () => true,
        () => false
      );
    }
    const closeSent = closeStatePersisted
      ? await this.posthogCapture(
          'app_closed',
          {
            event_ts_ms: closeTimestamp.getTime(),
            session_id: this.sessionId,
          },
          activeSession
            ? {
                uuid: recoveryEventId(activeSession.sessionId),
                timestamp: closeTimestamp,
                confirmTransport: true,
              }
            : undefined
        )
      : false;
    if (!closeSent && activeSession && this.sessionState) {
      const eventId = recoveryEventId(activeSession.sessionId);
      if (!this.sessionState.pendingRecoveries.some((recovery) => recovery.eventId === eventId)) {
        this.sessionState.pendingRecoveries.push({ ...activeSession, eventId });
      }
    }
    await this.flushPendingRequests(2_000);
    this.lifecycle = 'disposing';
    this.consentGeneration += 1;
    await this.closeSessionState().catch(() => undefined);
    await this.client?._shutdown(1_000).catch(() => undefined);
    this.client = undefined;
    this.lifecycle = 'disposed';
  }

  /**
   * Associate the current anonymous session with a known identity. Called via
   * the accountChanged hook when sign-in succeeds or on cold boot if a session
   * is already stored. Triggers a PostHog identify and a decide call to refresh
   * cached feature flags.
   */
  async identify(username: string, userId: string, email: string): Promise<void> {
    if (!username) return;
    this.cachedGithubUsername = username;
    this.cachedAccountId = userId;
    this.cachedEmail = email;
    await this.posthogIdentify(username, email);
    await this.posthogDecide();
  }

  /**
   * Clear the cached identity and feature flags. Called via the accountCleared
   * hook when the user signs out.
   */
  clearIdentity(): void {
    this.cachedGithubUsername = null;
    this.cachedAccountId = null;
    this.cachedEmail = null;
    this.cachedFeatureFlags = {};
  }

  capture<E extends TelemetryEvent>(
    event: E,
    properties?: TelemetryProperties<E> | Record<string, unknown>
  ): void {
    const captureSessionId = this.sessionId ?? randomUUID();
    this.sessionId = captureSessionId;
    const envelope: TelemetryEnvelope = {
      event_ts_ms: Date.now(),
      session_id: captureSessionId,
    };
    void this.trackRequest(
      this.posthogCapture(event, {
        ...(properties as Record<string, unknown> | undefined),
        ...envelope,
      })
    );
  }

  /**
   * Capture an exception for PostHog error tracking.
   */
  captureException(error: Error | unknown, additionalProperties?: Record<string, unknown>): void {
    void this.trackRequest(this.posthogCaptureException(error, additionalProperties));
  }

  async captureExceptionImmediate(
    error: Error | unknown,
    additionalProperties?: Record<string, unknown>
  ): Promise<void> {
    await this.trackRequest(this.posthogCaptureException(error, additionalProperties));
  }

  getTelemetryStatus() {
    return {
      enabled: this.isEnabled(),
      envDisabled: this.devBuild || !this.enabled,
      userOptOut: this.userOptOut === true,
      hasKeyAndHost: !!this.apiKey && !!this.host,
      session_id: this.sessionId ?? null,
      instance_id: this.instanceId ?? null,
    };
  }

  getInstanceId(): string | undefined {
    return this.instanceId;
  }

  async setTelemetryEnabledViaUser(enabledFlag: boolean): Promise<void> {
    if (this.lifecycle !== 'active') return;
    const previousOptOut = this.userOptOut;
    this.userOptOut = !enabledFlag;
    if (!enabledFlag) {
      this.consentGeneration += 1;
      this.requestController.abort();
      await this.client?.disable();
    }
    try {
      await this.kv.setOrThrow('enabled', String(enabledFlag));
    } catch (error) {
      if (!enabledFlag) {
        this.cachedFeatureFlags = {};
        await this.clearSessionState();
        await this.flushPendingRequests(2_000);
        throw error;
      }
      this.userOptOut = previousOptOut;
      if (!this.userOptOut) {
        this.requestController = new AbortController();
        await this.client?.enable();
      }
      throw error;
    }

    if (!enabledFlag) {
      this.cachedFeatureFlags = {};
      await this.clearSessionState();
      await this.flushPendingRequests(2_000);
      return;
    }

    this.consentGeneration += 1;
    this.requestController = new AbortController();
    await this.client?.enable();
    await this.ensureClient();
    try {
      await this.armSessionState();
    } catch (error) {
      this.userOptOut = true;
      this.consentGeneration += 1;
      this.requestController.abort();
      await this.client?.disable();
      await this.disarmSessionState();
      throw error;
    }
  }

  async checkAndReportDailyActiveUser(): Promise<void> {
    return this.checkDailyActiveUser();
  }

  /**
   * Returns the current set of evaluated feature flags. In dev mode, FLAG_*
   * environment variables (e.g. FLAG_my_flag=true) override any PostHog values.
   */
  getFeatureFlags(): Record<string, boolean> {
    if (!this.devBuild) return this.cachedFeatureFlags;

    const overrides: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith('FLAG_')) {
        const flagName = key.slice(5).toLowerCase().replace(/_/g, '-');
        overrides[flagName] = value === 'true' || value === '1';
      }
    }
    return { ...this.cachedFeatureFlags, ...overrides };
  }
}

export const telemetryService = new TelemetryService();
