import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import type { TelemetryEnvelope, TelemetryEvent, TelemetryProperties } from '@shared/telemetry';
import { KV } from '@main/db/kv';
import { env as appEnv } from '@main/lib/env';
import type { IDisposable, IInitializable } from '@main/lib/lifecycle';

interface InitOptions {
  installSource?: string;
}

type TelemetryKVSchema = {
  instanceId: string;
  enabled: string;
  lastActiveDate: string;
  lastSessionId: string;
  lastHeartbeatTs: string;
};

const LIB_NAME = 'emdash';
const isViteDevBuild = import.meta.env.DEV;

class TelemetryService implements IInitializable, IDisposable {
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
  private readonly kv = new KV<TelemetryKVSchema>('telemetry');

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private isEnabled(): boolean {
    return (
      !isViteDevBuild &&
      this.enabled === true &&
      this.userOptOut !== true &&
      !!this.apiKey &&
      !!this.host &&
      typeof this.instanceId === 'string' &&
      this.instanceId.length > 0
    );
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
  private sanitizeEventAndProps(
    _event: TelemetryEvent,
    props: Record<string, unknown> | undefined
  ) {
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
      'was_crash',
      'type',
    ]);
    const passthroughProps = new Set([
      '$exception_message',
      '$exception_type',
      '$exception_stack_trace_raw',
      '$exception_fingerprint',
    ]);

    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (!allowedProps.has(key) && !passthroughProps.has(key)) continue;

        if (typeof value === 'string') {
          const maxLength = passthroughProps.has(key) ? 2_000 : 100;
          sanitized[key] = value.trim().slice(0, maxLength);
        } else if (typeof value === 'number') {
          if (key === 'event_ts_ms') {
            sanitized[key] = Math.max(0, Math.min(Math.trunc(value), 9_999_999_999_999));
          } else {
            sanitized[key] = Math.max(-1_000_000, Math.min(value, 1_000_000));
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
    properties?: Record<string, unknown>
  ): Promise<void> {
    if (!this.isEnabled()) return;
    try {
      const u = (this.host ?? '').replace(/\/$/, '') + '/capture/';
      const body = {
        api_key: this.apiKey,
        event,
        properties: {
          distinct_id: this.instanceId,
          ...this.getBaseProps(),
          ...this.sanitizeEventAndProps(event, properties),
        },
      };
      await fetch(u, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5_000),
      }).catch(() => undefined);
    } catch {
      // swallow errors; telemetry must never crash the app
    }
  }

  private async posthogIdentify(username: string, email?: string): Promise<void> {
    if (!this.isEnabled() || !username) return;
    try {
      const u = (this.host ?? '').replace(/\/$/, '') + '/capture/';
      const body = {
        api_key: this.apiKey,
        event: '$identify',
        properties: {
          distinct_id: this.instanceId,
          $set: {
            ...(email ? { email } : {}),
            ...this.getBaseProps(),
          },
        },
      };
      await fetch(u, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5_000),
      }).catch(() => undefined);
    } catch {
      // swallow errors; telemetry must never crash the app
    }
  }

  private async posthogDecide(): Promise<void> {
    if (!this.isEnabled() || !this.instanceId) return;
    try {
      const u = (this.host ?? '').replace(/\/$/, '') + '/decide/?v=3';
      const body = {
        api_key: this.apiKey,
        distinct_id: this.instanceId,
        person_properties: {
          ...(this.cachedGithubUsername ? { github_username: this.cachedGithubUsername } : {}),
          ...(this.cachedAccountId ? { account_id: this.cachedAccountId } : {}),
          ...(this.cachedEmail ? { email: this.cachedEmail } : {}),
        },
      };
      const response = await fetch(u, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        const data = (await response.json()) as { featureFlags?: Record<string, unknown> };
        const flags = data.featureFlags ?? {};
        const parsed: Record<string, boolean> = {};
        for (const [key, value] of Object.entries(flags)) {
          if (typeof value === 'boolean') {
            parsed[key] = value;
          } else if (value === 'true' || value === 'false') {
            parsed[key] = value === 'true';
          }
        }
        this.cachedFeatureFlags = parsed;
      }
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

      void this.posthogCapture('daily_active_user', {
        date: today,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
      });

      this.lastActiveDate = today;
      void this.kv.set('lastActiveDate', today);
    } catch {
      // Never let telemetry errors crash the app
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async initialize(options?: InitOptions): Promise<void> {
    const enabledEnv = (appEnv.runtime.TELEMETRY_ENABLED ?? 'true').toLowerCase();
    this.enabled =
      !isViteDevBuild && enabledEnv !== 'false' && enabledEnv !== '0' && enabledEnv !== 'no';
    // build value wins (prod); dev fallback used locally without VITE_ vars set
    this.apiKey = appEnv.build.VITE_POSTHOG_KEY ?? appEnv.dev.POSTHOG_PROJECT_API_KEY;
    this.host = this.normalizeHost(appEnv.build.VITE_POSTHOG_HOST ?? appEnv.dev.POSTHOG_HOST);
    this.installSource = options?.installSource ?? appEnv.runtime.INSTALL_SOURCE;
    this.sessionId = randomUUID();

    // Load persisted state from SQLite KV (all reads are non-blocking best-effort)
    let storedInstanceId: string | null = null;
    let storedEnabled: string | null = null;
    let storedActiveDate: string | null = null;
    let storedLastSessionId: string | null = null;
    let storedLastHeartbeatTs: string | null = null;
    try {
      [
        storedInstanceId,
        storedEnabled,
        storedActiveDate,
        storedLastSessionId,
        storedLastHeartbeatTs,
      ] = await Promise.all([
        this.kv.get('instanceId'),
        this.kv.get('enabled'),
        this.kv.get('lastActiveDate'),
        this.kv.get('lastSessionId'),
        this.kv.get('lastHeartbeatTs'),
      ]);
    } catch {
      // KV unavailable during startup (e.g. DB migration not yet applied) — use in-memory defaults
    }

    this.instanceId = storedInstanceId ?? (randomUUID().toString() as string);
    if (!storedInstanceId) {
      void this.kv.set('instanceId', this.instanceId);
    }

    this.userOptOut = storedEnabled === 'false' ? true : undefined;
    this.lastActiveDate = storedActiveDate ?? undefined;

    // Detect unclean exit from the previous session: if we have a recorded session ID
    // that was never cleared by a clean shutdown, emit a synthetic app_closed so that
    // session duration queries remain accurate.
    if (storedLastSessionId && storedLastHeartbeatTs) {
      const lastHeartbeatMs = Date.parse(storedLastHeartbeatTs);
      if (!Number.isNaN(lastHeartbeatMs)) {
        void this.posthogCapture('app_closed', {
          was_crash: true,
          event_ts_ms: lastHeartbeatMs,
          session_id: storedLastSessionId,
        });
      }
    }
    // Record the current session ID so the next startup can detect a crash.
    // sessionId is guaranteed non-undefined at this point (set to randomUUID() above).
    void this.kv.set('lastSessionId', this.sessionId!);

    void this.posthogCapture('app_started');
    void this.checkDailyActiveUser();

    // Heartbeat: write lastHeartbeatTs to KV every 60 s so crash recovery can
    // estimate session duration without firing any PostHog events.
    this.heartbeatInterval = setInterval(() => {
      void this.kv.set('lastHeartbeatTs', new Date().toISOString());
    }, 60_000);
  }

  async dispose(): Promise<void> {
    if (this.heartbeatInterval !== undefined) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
    // Await both deletes so the process cannot exit before they complete.
    // If these are fire-and-forget, the next startup will see lastSessionId still
    // in KV and incorrectly emit a synthetic app_closed with was_crash: true.
    await Promise.all([this.kv.del('lastSessionId'), this.kv.del('lastHeartbeatTs')]);
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
    void this.posthogCapture(event, {
      ...(properties as Record<string, unknown> | undefined),
      ...envelope,
    });
  }

  /**
   * Capture an exception for PostHog error tracking.
   */
  captureException(error: Error | unknown, additionalProperties?: Record<string, unknown>): void {
    if (!this.isEnabled()) return;

    const errorObj = error instanceof Error ? error : new Error(String(error));

    void this.posthogCapture('$exception', {
      $exception_message: errorObj.message || 'Unknown error',
      $exception_type: errorObj.name || 'Error',
      $exception_stack_trace_raw: errorObj.stack || '',
      ...additionalProperties,
    });
  }

  getTelemetryStatus() {
    return {
      enabled: this.isEnabled(),
      envDisabled: isViteDevBuild || !this.enabled,
      userOptOut: this.userOptOut === true,
      hasKeyAndHost: !!this.apiKey && !!this.host,
      session_id: this.sessionId ?? null,
      instance_id: this.instanceId ?? null,
    };
  }

  setTelemetryEnabledViaUser(enabledFlag: boolean): void {
    this.userOptOut = !enabledFlag;
    void this.kv.set('enabled', String(enabledFlag));
  }

  async checkAndReportDailyActiveUser(): Promise<void> {
    return this.checkDailyActiveUser();
  }

  /**
   * Returns the current set of evaluated feature flags. In dev mode, FLAG_*
   * environment variables (e.g. FLAG_my_flag=true) override any PostHog values.
   */
  getFeatureFlags(): Record<string, boolean> {
    if (!isViteDevBuild) return this.cachedFeatureFlags;

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
