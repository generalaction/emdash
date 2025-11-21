import { app } from 'electron';
// Optional build-time defaults for distribution bundles
// Resolve robustly across dev and packaged layouts.
let appConfig: { posthogHost?: string; posthogKey?: string } = {};
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

function loadAppConfig(): { posthogHost?: string; posthogKey?: string } {
  try {
    const dir = __dirname; // e.g., dist/main/main in dev builds
    const candidates = [
      join(dir, 'appConfig.json'), // dist/main/main/appConfig.json
      join(dir, '..', 'appConfig.json'), // dist/main/appConfig.json (CI injection path)
    ];
    for (const p of candidates) {
      if (existsSync(p)) {
        const raw = readFileSync(p, 'utf8');
        return JSON.parse(raw);
      }
    }
  } catch {
    // fall through
  }
  return {};
}
appConfig = loadAppConfig();

type TelemetryEvent =
  | 'app_started'
  | 'app_closed'
  | 'feature_used'
  | 'error'
  // Aggregates (privacy-safe)
  | 'workspace_snapshot'
  // Session summary (duration only)
  | 'app_session'
  // Agent usage (provider-level only)
  | 'agent_run_start'
  | 'agent_run_finish';

interface InitOptions {
  installSource?: string;
}

let enabled = true;
let apiKey: string | undefined;
let host: string | undefined;
let instanceId: string | undefined;
let installSource: string | undefined;
let userOptOut: boolean | undefined; // persisted user setting
let sessionRecordingOptIn = false; // persisted user setting
let sessionStartMs: number = Date.now();

const libName = 'emdash';

function getVersionSafe(): string {
  try {
    return app.getVersion();
  } catch {
    return 'unknown';
  }
}

function getInstanceIdPath(): string {
  const dir = app.getPath('userData');
  return join(dir, 'telemetry.json');
}

function loadOrCreateState(): {
  instanceId: string;
  enabledOverride?: boolean;
  sessionRecordingOptIn?: boolean;
} {
  try {
    const file = getInstanceIdPath();
    if (existsSync(file)) {
      const raw = readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.instanceId === 'string' && parsed.instanceId.length > 0) {
        const enabledOverride =
          typeof parsed.enabled === 'boolean' ? (parsed.enabled as boolean) : undefined;
        const sessionRecordingOptIn =
          typeof parsed.sessionRecordingOptIn === 'boolean'
            ? (parsed.sessionRecordingOptIn as boolean)
            : undefined;
        return { instanceId: parsed.instanceId as string, enabledOverride, sessionRecordingOptIn };
      }
    }
  } catch {
    // fall through to create
  }
  // Create new random ID
  const id = cryptoRandomId();
  try {
    persistState({ instanceId: id });
  } catch {
    // ignore write errors; still use in-memory id
  }
  return { instanceId: id };
}

function cryptoRandomId(): string {
  try {
    const { randomUUID } = require('crypto');
    return randomUUID();
  } catch {
    // Very old Node fallback; not expected in Electron 28+
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
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
    app_version: getVersionSafe(),
    electron_version: process.versions.electron,
    platform: process.platform,
    arch: process.arch,
    is_dev: !app.isPackaged,
    install_source: installSource ?? (app.isPackaged ? 'dmg' : 'dev'),
    $lib: libName,
  } as const;
}

function sanitizeEventAndProps(event: TelemetryEvent, props: Record<string, any> | undefined) {
  const p: Record<string, any> = {};
  const baseAllowed = new Set([
    // explicitly allow only these keys to avoid PII
    'feature',
    'type',
    'provider',
    'outcome',
    'duration_ms',
    // session
    'session_duration_ms',
    // aggregates (counts + buckets only)
    'workspace_count',
    'workspace_count_bucket',
    'project_count',
    'project_count_bucket',
  ]);

  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (!baseAllowed.has(k)) continue;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        p[k] = v;
      }
    }
  }

  // Helpers
  const clampInt = (n: any, min = 0, max = 10_000_000) => {
    const v = typeof n === 'number' ? Math.floor(n) : Number.parseInt(String(n), 10);
    if (!Number.isFinite(v)) return undefined;
    return Math.min(Math.max(v, min), max);
  };

  const BUCKETS = new Set(['0', '1-2', '3-5', '6-10', '>10']);
  const PROVIDERS = new Set(['codex', 'claude']);
  const OUTCOMES = new Set(['ok', 'error']);

  // Event-specific constraints
  switch (event) {
    case 'feature_used':
      // Only retain a simple feature name
      if (typeof p.feature !== 'string') delete p.feature;
      break;
    case 'error':
      if (typeof p.type !== 'string') delete p.type;
      break;
    case 'app_session':
      // Only duration
      if (p.session_duration_ms != null) {
        const v = clampInt(p.session_duration_ms, 0, 1000 * 60 * 60 * 24); // up to 24h
        if (v == null) delete p.session_duration_ms;
        else p.session_duration_ms = v;
      }
      // strip any other keys
      for (const k of Object.keys(p)) if (k !== 'session_duration_ms') delete p[k];
      break;
    case 'agent_run_start':
      if (!p.provider || !PROVIDERS.has(String(p.provider))) delete p.provider;
      // strip everything else
      for (const k of Object.keys(p)) if (k !== 'provider') delete p[k];
      break;
    case 'agent_run_finish':
      if (!p.provider || !PROVIDERS.has(String(p.provider))) delete p.provider;
      if (!p.outcome || !OUTCOMES.has(String(p.outcome))) delete p.outcome;
      if (p.duration_ms != null) {
        const v = clampInt(p.duration_ms, 0, 1000 * 60 * 60 * 24);
        if (v == null) delete p.duration_ms;
        else p.duration_ms = v;
      }
      for (const k of Object.keys(p)) {
        if (k !== 'provider' && k !== 'outcome' && k !== 'duration_ms') delete p[k];
      }
      break;
    case 'workspace_snapshot':
      // Allow only counts and very coarse buckets
      if (p.workspace_count != null) {
        const v = clampInt(p.workspace_count, 0, 100000);
        if (v == null) delete p.workspace_count;
        else p.workspace_count = v;
      }
      if (p.project_count != null) {
        const v = clampInt(p.project_count, 0, 100000);
        if (v == null) delete p.project_count;
        else p.project_count = v;
      }
      if (p.workspace_count_bucket && !BUCKETS.has(String(p.workspace_count_bucket))) {
        delete p.workspace_count_bucket;
      }
      if (p.project_count_bucket && !BUCKETS.has(String(p.project_count_bucket))) {
        delete p.project_count_bucket;
      }
      // strip anything else
      for (const k of Object.keys(p)) {
        if (
          k !== 'workspace_count' &&
          k !== 'workspace_count_bucket' &&
          k !== 'project_count' &&
          k !== 'project_count_bucket'
        ) {
          delete p[k];
        }
      }
      break;
    default:
      // no additional props for lifecycle events
      for (const k of Object.keys(p)) delete p[k];
      break;
  }

  return p;
}

async function posthogCapture(
  event: TelemetryEvent,
  properties?: Record<string, any>
): Promise<void> {
  if (!isEnabled()) return;
  try {
    // Use global fetch if available (Node 18+/Electron 28+)
    const f: any = (globalThis as any).fetch;
    if (!f) return;
    const u = (host || '').replace(/\/$/, '') + '/capture/';
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

export function init(options?: InitOptions) {
  const env = process.env;
  const enabledEnv = (env.TELEMETRY_ENABLED ?? 'true').toString().toLowerCase();
  enabled = enabledEnv !== 'false' && enabledEnv !== '0' && enabledEnv !== 'no';
  apiKey =
    env.POSTHOG_PROJECT_API_KEY || (appConfig?.posthogKey as string | undefined) || undefined;
  host = normalizeHost(
    env.POSTHOG_HOST || (appConfig?.posthogHost as string | undefined) || undefined
  );
  installSource = options?.installSource || env.INSTALL_SOURCE || undefined;

  const state = loadOrCreateState();
  instanceId = state.instanceId;
  sessionStartMs = Date.now();
  // If enabledOverride is explicitly false, user opted out; otherwise leave undefined
  userOptOut =
    typeof state.enabledOverride === 'boolean' ? state.enabledOverride === false : undefined;
  sessionRecordingOptIn = state.sessionRecordingOptIn === true;

  // Fire lifecycle start
  void posthogCapture('app_started');
}

export function capture(event: TelemetryEvent, properties?: Record<string, any>) {
  if (event === 'app_session') {
    const dur = Math.max(0, Date.now() - (sessionStartMs || Date.now()));
    void posthogCapture(event, { session_duration_ms: dur });
    return;
  }
  void posthogCapture(event, properties);
}

export function shutdown() {
  // No-op for now (no batching). Left for future posthog-node integration.
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
    sessionRecordingOptIn,
  };
}

export function setTelemetryEnabledViaUser(enabledFlag: boolean) {
  userOptOut = !enabledFlag;
  // Persist alongside instanceId
  try {
    const file = getInstanceIdPath();
    let state: any = {};
    if (existsSync(file)) {
      try {
        state = JSON.parse(readFileSync(file, 'utf8')) || {};
      } catch {
        state = {};
      }
    }
    state.instanceId = instanceId || state.instanceId || cryptoRandomId();
    state.enabled = enabledFlag; // store explicit preference
    state.updatedAt = new Date().toISOString();
    writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
  } catch {
    // ignore
  }
}

export function setSessionRecordingOptIn(optIn: boolean) {
  sessionRecordingOptIn = Boolean(optIn);
  try {
    const file = getInstanceIdPath();
    let state: any = {};
    if (existsSync(file)) {
      try {
        state = JSON.parse(readFileSync(file, 'utf8')) || {};
      } catch {
        state = {};
      }
    }
    state.instanceId = instanceId || state.instanceId || cryptoRandomId();
    state.sessionRecordingOptIn = sessionRecordingOptIn;
    state.updatedAt = new Date().toISOString();
    writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
  } catch {
    // ignore
  }
}

function persistState(state: {
  instanceId: string;
  enabledOverride?: boolean;
  sessionRecordingOptIn?: boolean;
}) {
  try {
    const existing = existsSync(getInstanceIdPath())
      ? JSON.parse(readFileSync(getInstanceIdPath(), 'utf8'))
      : {};
    const merged = {
      ...existing,
      instanceId: state.instanceId,
      enabled:
        typeof state.enabledOverride === 'boolean' ? state.enabledOverride : existing.enabled,
      sessionRecordingOptIn:
        typeof state.sessionRecordingOptIn === 'boolean'
          ? state.sessionRecordingOptIn
          : existing.sessionRecordingOptIn,
      createdAt: existing.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(getInstanceIdPath(), JSON.stringify(merged, null, 2), 'utf8');
  } catch {
    // ignore
  }
}

function normalizeHost(h: string | undefined): string | undefined {
  if (!h) return undefined;
  let s = String(h).trim();
  if (!/^https?:\/\//i.test(s)) {
    s = 'https://' + s;
  }
  return s.replace(/\/+$/, '');
}
