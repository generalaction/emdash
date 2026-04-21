import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { TelemetryEnvelope, TelemetryEvent, TelemetryProperties } from '@shared/telemetry';
import { KV } from '@main/db/kv';

// Production-only: appConfig.json is injected into dist/main/ by the release pipeline.
const appConfig: { posthogHost?: string; posthogKey?: string } = (() => {
  if (!import.meta.env.PROD) return {};
  try {
    const raw = readFileSync(join(__dirname, 'appConfig.json'), 'utf-8');
    return JSON.parse(raw) as { posthogHost?: string; posthogKey?: string };
  } catch {
    return {};
  }
})();

interface InitOptions {
  installSource?: string;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let enabled = true;
let apiKey: string | undefined;
let host: string | undefined;
let instanceId: string | undefined;
let installSource: string | undefined;
let userOptOut: boolean | undefined;
let onboardingSeen = false;
let sessionId: string | undefined;
let lastActiveDate: string | undefined;
let cachedGithubUsername: string | null = null;
let cachedAccountId: string | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | undefined;

const libName = 'emdash';

type TelemetryKVSchema = {
  instanceId: string;
  enabled: string;
  onboardingSeen: string;
  lastActiveDate: string;
  githubUsername: string;
  accountId: string;
  lastSessionId: string;
  lastHeartbeatTs: string;
};

const telemetryKV = new KV<TelemetryKVSchema>('telemetry');

function getVersionSafe(): string {
  try {
    return app.getVersion();
  } catch {
    return 'unknown';
  }
}

function isEnabled(): boolean {
  return (
    enabled === true &&
    userOptOut !== true &&
    !!apiKey &&
    !!host &&
    typeof instanceId === 'string' &&
    instanceId.length > 0
  );
}

function getBaseProps() {
  return {
    schema_version: 1,
    app_version: getVersionSafe(),
    electron_version: process.versions.electron,
    platform: process.platform,
    arch: process.arch,
    is_dev: !app.isPackaged,
    install_source: installSource ?? (app.isPackaged ? 'dmg' : 'dev'),
    $lib: libName,
    ...(cachedGithubUsername ? { github_username: cachedGithubUsername } : {}),
    ...(cachedAccountId ? { account_id: cachedAccountId } : {}),
  };
}

/**
 * Sanitize event properties to prevent PII leakage.
 * Simple allowlist approach: only allow safe property names and primitive types.
 */
function sanitizeEventAndProps(_event: TelemetryEvent, props: Record<string, unknown> | undefined) {
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

function normalizeHost(h: string | undefined): string | undefined {
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

async function posthogCapture(
  event: TelemetryEvent,
  properties?: Record<string, unknown>
): Promise<void> {
  if (!isEnabled()) return;
  try {
    const f = (globalThis as { fetch?: typeof fetch }).fetch;
    if (!f) return;
    const u = (host ?? '').replace(/\/$/, '') + '/capture/';
    const body = {
      api_key: apiKey,
      event,
      properties: {
        distinct_id: instanceId,
        ...getBaseProps(),
        ...sanitizeEventAndProps(event, properties),
      },
    };
    await f(u, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => undefined);
  } catch {
    // swallow errors; telemetry must never crash the app
  }
}

async function posthogIdentify(username: string, accountId?: string): Promise<void> {
  if (!isEnabled() || !username) return;
  try {
    const f = (globalThis as { fetch?: typeof fetch }).fetch;
    if (!f) return;
    const u = (host ?? '').replace(/\/$/, '') + '/capture/';
    const body = {
      api_key: apiKey,
      event: '$identify',
      properties: {
        distinct_id: instanceId,
        $set: {
          github_username: username,
          ...(accountId ? { account_id: accountId } : {}),
          ...getBaseProps(),
        },
      },
    };
    await f(u, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => undefined);
  } catch {
    // swallow errors; telemetry must never crash the app
  }
}

// ---------------------------------------------------------------------------
// Daily active user
// ---------------------------------------------------------------------------

async function checkDailyActiveUser(): Promise<void> {
  if (!isEnabled()) return;
  try {
    const today = new Date().toISOString().split('T')[0]!;
    if (lastActiveDate === today) return;

    void posthogCapture('daily_active_user', {
      date: today,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
    });

    lastActiveDate = today;
    telemetryKV.set('lastActiveDate', today);
  } catch {
    // Never let telemetry errors crash the app
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function init(options?: InitOptions): Promise<void> {
  const env = process.env;
  const enabledEnv = (env.TELEMETRY_ENABLED ?? 'true').toString().toLowerCase();
  enabled = enabledEnv !== 'false' && enabledEnv !== '0' && enabledEnv !== 'no';
  apiKey =
    env.POSTHOG_PROJECT_API_KEY || (appConfig?.posthogKey as string | undefined) || undefined;
  host = normalizeHost(
    env.POSTHOG_HOST || (appConfig?.posthogHost as string | undefined) || undefined
  );
  installSource = options?.installSource || env.INSTALL_SOURCE || undefined;
  sessionId = randomUUID();

  // Load persisted state from SQLite KV (all reads are non-blocking best-effort)
  let storedInstanceId: string | null = null;
  let storedEnabled: string | null = null;
  let storedOnboarding: string | null = null;
  let storedActiveDate: string | null = null;
  let storedGithubUsername: string | null = null;
  let storedAccountId: string | null = null;
  let storedLastSessionId: string | null = null;
  let storedLastHeartbeatTs: string | null = null;
  try {
    [
      storedInstanceId,
      storedEnabled,
      storedOnboarding,
      storedActiveDate,
      storedGithubUsername,
      storedAccountId,
      storedLastSessionId,
      storedLastHeartbeatTs,
    ] = await Promise.all([
      telemetryKV.get('instanceId'),
      telemetryKV.get('enabled'),
      telemetryKV.get('onboardingSeen'),
      telemetryKV.get('lastActiveDate'),
      telemetryKV.get('githubUsername'),
      telemetryKV.get('accountId'),
      telemetryKV.get('lastSessionId'),
      telemetryKV.get('lastHeartbeatTs'),
    ]);
  } catch {
    // KV unavailable during startup (e.g. DB migration not yet applied) — use in-memory defaults
  }

  instanceId = storedInstanceId ?? (randomUUID().toString() as string);
  if (!storedInstanceId) {
    telemetryKV.set('instanceId', instanceId);
  }

  userOptOut = storedEnabled === 'false' ? true : undefined;
  onboardingSeen = storedOnboarding === 'true';
  lastActiveDate = storedActiveDate ?? undefined;
  cachedGithubUsername = storedGithubUsername ?? null;
  cachedAccountId = storedAccountId ?? null;
  if (cachedGithubUsername) {
    void posthogIdentify(cachedGithubUsername, cachedAccountId ?? undefined);
  }

  // Detect unclean exit from the previous session: if we have a recorded session ID
  // that was never cleared by a clean shutdown, emit a synthetic app_closed so that
  // session duration queries remain accurate.
  if (storedLastSessionId && storedLastHeartbeatTs) {
    const lastHeartbeatMs = Date.parse(storedLastHeartbeatTs);
    if (!Number.isNaN(lastHeartbeatMs)) {
      void posthogCapture('app_closed', {
        was_crash: true,
        event_ts_ms: lastHeartbeatMs,
        session_id: storedLastSessionId,
      });
    }
  }
  // Record the current session ID so the next startup can detect a crash.
  // sessionId is guaranteed non-undefined at this point (set to randomUUID() above).
  void telemetryKV.set('lastSessionId', sessionId!);

  void posthogCapture('app_started');
  void checkDailyActiveUser();

  // Heartbeat: write lastHeartbeatTs to KV every 60 s so crash recovery can
  // estimate session duration without firing any PostHog events.
  heartbeatInterval = setInterval(() => {
    telemetryKV.set('lastHeartbeatTs', new Date().toISOString());
  }, 60_000);
}

/**
 * Associate the current anonymous session with a known identity. Call this
 * whenever authentication succeeds — pass the GitHub username and, optionally,
 * the emdash account ID so both are linked in PostHog.
 */
export function identify(username: string, accountId?: string): void {
  if (!username) return;
  cachedGithubUsername = username;
  void telemetryKV.set('githubUsername', username);
  if (accountId) {
    cachedAccountId = accountId;
    void telemetryKV.set('accountId', accountId);
  }
  void posthogIdentify(username, accountId ?? cachedAccountId ?? undefined);
}

export function capture<E extends TelemetryEvent>(
  event: E,
  properties?: TelemetryProperties<E> | Record<string, unknown>
): void {
  const captureSessionId = sessionId ?? randomUUID();
  sessionId = captureSessionId;
  const envelope: TelemetryEnvelope = {
    event_ts_ms: Date.now(),
    session_id: captureSessionId,
  };
  void posthogCapture(event, {
    ...(properties as Record<string, unknown> | undefined),
    ...envelope,
  });
}

/**
 * Capture an exception for PostHog error tracking.
 */
export function captureException(
  error: Error | unknown,
  additionalProperties?: Record<string, unknown>
): void {
  if (!isEnabled()) return;

  const errorObj = error instanceof Error ? error : new Error(String(error));

  void posthogCapture('$exception', {
    $exception_message: errorObj.message || 'Unknown error',
    $exception_type: errorObj.name || 'Error',
    $exception_stack_trace_raw: errorObj.stack || '',
    ...additionalProperties,
  });
}

export function shutdown(): void {
  // Stop the heartbeat interval.
  if (heartbeatInterval !== undefined) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = undefined;
  }
  // Clear the stored session ID so the next startup knows this was a clean exit
  // and won't emit a synthetic crash app_closed event.
  void telemetryKV.del('lastSessionId');
  void telemetryKV.del('lastHeartbeatTs');
}

export function isTelemetryEnabled(): boolean {
  return isEnabled();
}

export function getTelemetryStatus() {
  return {
    enabled: isEnabled(),
    envDisabled: !enabled,
    userOptOut: userOptOut === true,
    hasKeyAndHost: !!apiKey && !!host,
    onboardingSeen,
    session_id: sessionId ?? null,
  };
}

export function setTelemetryEnabledViaUser(enabledFlag: boolean): void {
  userOptOut = !enabledFlag;
  telemetryKV.set('enabled', String(enabledFlag));
}

export function setOnboardingSeen(flag: boolean): void {
  onboardingSeen = Boolean(flag);
  telemetryKV.set('onboardingSeen', String(onboardingSeen));
}

export async function checkAndReportDailyActiveUser(): Promise<void> {
  return checkDailyActiveUser();
}
