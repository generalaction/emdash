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
  // App lifecycle
  | 'app_started'
  | 'app_closed'
  | 'app_window_focused' // when a user return back to the app after being away
  | 'github_connection_triggered' // when a user presses the GitHub connection button in the app (with state if gh cli already installed or not)
  | 'github_connected' // when a user connects to their GitHub account
  // Project management
  | 'project_add_clicked' // left sidebar button to add projects
  | 'project_open_clicked' // button in the center to open Projects (Home View)
  | 'project_create_clicked' // button in the center to create a new project (Home View)
  | 'project_clone_clicked' // button in the center to clone a project from GitHub (Home View)
  | 'project_create_success' // when a project is successfully created from the homepage
  | 'project_clone_success' // when a project is successfully cloned from the homepage
  | 'project_added_success' // when a project is added successfully (both entrypoint buttons)
  | 'project_deleted'
  | 'project_view_opened' // when a user opens a project and see the Task overview in main screen (not the sidebar)
  // Task management
  | 'task_created' // when a new task is created (track) (with all attributes, if initial prompt is used (but dont store the initial prompt itself))
  | 'task_deleted' // when a task is deleted
  | 'task_provider_switched' // when a task is switched to a different provider
  | 'task_custom_named' // when a task is given a custom name instead of the default generated one
  | 'task_advanced_options_opened' // when task advanced options are opened
  // Terminal (Right Sidebar)
  | 'terminal_entered' //when a user enters the terminal (right sidebar) with his mouse
  | 'terminal_command_executed' //when a user executes a command in the terminal
  | 'terminal_new_terminal_created'
  | 'terminal_deleted'
  // Changes (Right Sidebar)
  | 'changes_viewed' // when a user clicks on one file to view their changes
  // Plan mode
  | 'plan_mode_enabled'
  | 'plan_mode_disabled'
  // Git & Pull Requests
  | 'pr_created'
  | 'pr_creation_failed'
  | 'pr_viewed'
  // Linear integration
  | 'linear_connected'
  | 'linear_disconnected'
  | 'linear_issues_searched' // when creating a new task and the Linear issue search is opened
  | 'linear_issue_selected' // when a user selects a Linear issue to create a new task (no need to send task, just selecting issue)
  // Jira integration
  | 'jira_connected'
  | 'jira_disconnected'
  | 'jira_issues_searched'
  | 'jira_issue_selected'
  // Container & Dev Environment
  | 'container_connect_clicked'
  | 'container_connect_success'
  | 'container_connect_failed'
  // ToolBar Section
  | 'toolbar_feedback_clicked' // when a user clicks on the feedback button in the toolbar
  | 'toolbar_left_sidebar_clicked' // when a user clicks on the left sidebar button in the toolbar (attribute for new state (open or closed))
  | 'toolbar_right_sidebar_clicked' // when a user clicks on the right sidebar button in the toolbar (attribute for new state (open or closed))
  | 'toolbar_settings_clicked' // when a user clicks on the settings button in the toolbar
  | 'toolbar_open_in_menu_clicked' // when a user clicks on the "Open in" menu button (attribute for new state (open or closed))
  | 'toolbar_open_in_selected' // when a user selects an app from the "Open in" menu (attribute for which app was selected: finder, cursor, vscode, terminal, warp, iterm2, ghostty, zed)
  | 'toolbar_kanban_toggled' // when a user toggles the Kanban view (attribute for new state (open or closed))
  // Browser Preview
  | 'browser_preview_closed'
  | 'browser_preview_url_navigated' // when a user navigates to a new URL in the browser preview
  // Settings & Preferences
  | 'settings_tab_viewed' // when a user opens the settings (Settings View) (attribute for which tab is opened)
  | 'theme_changed'
  | 'telemetry_toggled'
  | 'notification_settings_changed'
  | 'default_provider_changed' // attribute for which provider is selected
  // Legacy/aggregate events
  | 'feature_used'
  | 'error'
  // Aggregates (privacy-safe)
  | 'task_snapshot'
  // Session summary (duration only)
  | 'app_session'
  // Agent usage (provider-level only)
  | 'agent_run_start'
  | 'agent_run_finish'
  // DB setup (privacy-safe)
  | 'db_setup'
  // Daily active user tracking
  | 'daily_active_user';

interface InitOptions {
  installSource?: string;
}

let enabled = true;
let apiKey: string | undefined;
let host: string | undefined;
let instanceId: string | undefined;
let installSource: string | undefined;
let userOptOut: boolean | undefined;
let onboardingSeen: boolean = false;
let sessionStartMs: number = Date.now();
let lastActiveDate: string | undefined;

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
  onboardingSeen?: boolean;
  lastActiveDate?: string;
} {
  try {
    const file = getInstanceIdPath();
    if (existsSync(file)) {
      const raw = readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.instanceId === 'string' && parsed.instanceId.length > 0) {
        const enabledOverride =
          typeof parsed.enabled === 'boolean' ? (parsed.enabled as boolean) : undefined;
        const onboardingSeen =
          typeof parsed.onboardingSeen === 'boolean' ? (parsed.onboardingSeen as boolean) : false;
        const lastActiveDate =
          typeof parsed.lastActiveDate === 'string' ? (parsed.lastActiveDate as string) : undefined;
        return {
          instanceId: parsed.instanceId as string,
          enabledOverride,
          onboardingSeen,
          lastActiveDate,
        };
      }
    }
  } catch {
    // fall through to create
  }
  const newId = cryptoRandomId();
  try {
    writeFileSync(getInstanceIdPath(), JSON.stringify({ instanceId: newId }, null, 2), 'utf8');
  } catch {
    // ignore
  }
  return { instanceId: newId };
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

/**
 * Sanitize event properties to prevent PII leakage.
 * Simple allowlist approach: only allow safe property names and primitive types.
 */
function sanitizeEventAndProps(event: TelemetryEvent, props: Record<string, any> | undefined) {
  const sanitized: Record<string, any> = {};

  // Simple allowlist of safe properties
  const allowedProps = new Set([
    'provider',
    'source',
    'tab',
    'theme',
    'trigger',
    'has_initial_prompt',
    'custom_name',
    'state',
    'success',
    'error_type',
    'gh_cli_installed',
    'feature',
    'type',
    'enabled',
    'sound',
    'app',
    'duration_ms',
    'session_duration_ms',
    'outcome',
    'applied_migrations',
    'applied_migrations_bucket',
    'recovered',
    'task_count',
    'task_count_bucket',
    'project_count',
    'project_count_bucket',
    'date',
    'timezone',
  ]);

  if (props) {
    for (const [key, value] of Object.entries(props)) {
      // Only process allowed property names
      if (!allowedProps.has(key)) continue;

      // Only allow primitive types
      if (typeof value === 'string') {
        // Trim and limit string length to prevent abuse
        sanitized[key] = value.trim().slice(0, 100);
      } else if (typeof value === 'number') {
        // Clamp numbers to reasonable range
        sanitized[key] = Math.max(0, Math.min(value, 1000000));
      } else if (typeof value === 'boolean') {
        sanitized[key] = value;
      }
    }
  }

  return sanitized;
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
  onboardingSeen = state.onboardingSeen === true;
  lastActiveDate = state.lastActiveDate;

  // Fire lifecycle start
  void posthogCapture('app_started');

  // Check for daily active user (fires event if it's a new day)
  checkDailyActiveUser();
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
    onboardingSeen,
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

function persistState(state: {
  instanceId: string;
  enabledOverride?: boolean;
  onboardingSeen?: boolean;
  lastActiveDate?: string;
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
      onboardingSeen:
        typeof state.onboardingSeen === 'boolean' ? state.onboardingSeen : existing.onboardingSeen,
      lastActiveDate:
        typeof state.lastActiveDate === 'string' ? state.lastActiveDate : existing.lastActiveDate,
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

/**
 * Check if this is a new day of activity and fire daily_active_user event if so.
 * This ensures we accurately track DAU even when the app stays open for extended periods.
 */
function checkDailyActiveUser(): void {
  // Skip if telemetry is disabled
  if (!isEnabled()) return;

  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

    // If we haven't tracked a date yet or it's a new day, fire the event
    if (!lastActiveDate || lastActiveDate !== today) {
      // Fire the daily active user event
      void posthogCapture('daily_active_user', {
        date: today,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
      });

      // Update the last active date in memory
      lastActiveDate = today;

      // Persist the new date to storage
      persistState({
        instanceId: instanceId || cryptoRandomId(),
        enabledOverride: userOptOut === undefined ? undefined : !userOptOut,
        onboardingSeen,
        lastActiveDate: today,
      });
    }
  } catch (error) {
    // Never let telemetry errors crash the app
    // Optionally log for debugging: console.error('DAU tracking error:', error);
  }
}

/**
 * Export for use in window focus events
 */
export function checkAndReportDailyActiveUser(): void {
  checkDailyActiveUser();
}

export function setOnboardingSeen(flag: boolean) {
  onboardingSeen = Boolean(flag);
  try {
    persistState({
      instanceId: instanceId || cryptoRandomId(),
      onboardingSeen,
      enabledOverride: userOptOut === undefined ? undefined : !userOptOut,
    });
  } catch {
    // ignore
  }
}
