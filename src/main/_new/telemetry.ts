import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import rawAppConfig from '../appConfig.json';
import { KV } from './db/kv';

// Build-time defaults from appConfig.json (bundled by electron-vite)
const appConfig: { posthogHost?: string; posthogKey?: string } = rawAppConfig;

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
  | 'toolbar_open_in_selected' // when a user selects an app from the "Open in" menu (attribute: OpenInAppId)
  | 'toolbar_kanban_toggled' // when a user toggles the Kanban view (attribute for new state (open or closed))
  // Browser Preview
  | 'browser_preview_opened'
  | 'browser_preview_closed'
  | 'browser_preview_url_navigated' // when a user navigates to a new URL in the browser preview
  // Settings & Preferences
  | 'settings_tab_viewed' // when a user opens the settings (Settings View) (attribute for which tab is opened)
  | 'theme_changed'
  | 'telemetry_toggled'
  | 'notification_settings_changed'
  | 'default_provider_changed' // attribute for which provider is selected
  // Skills
  | 'skills_view_opened'
  | 'skill_installed'
  | 'skill_uninstalled'
  | 'skill_created'
  | 'skill_detail_viewed'
  // Remote Server / SSH
  | 'remote_project_modal_opened'
  | 'remote_project_connection_tested'
  | 'remote_project_created'
  | 'ssh_connection_saved'
  | 'ssh_repo_init'
  | 'ssh_repo_clone'
  | 'ssh_connection_deleted'
  | 'ssh_connect_success'
  | 'ssh_connect_failed'
  | 'ssh_disconnected'
  | 'ssh_reconnect_attempted'
  | 'ssh_settings_opened'
  // GitHub issues
  | 'github_issues_searched'
  | 'github_issue_selected'
  // Task with issue
  | 'task_created_with_issue'
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
  | 'agent_prompt_sent'
  // DB setup (privacy-safe)
  | 'db_setup'
  // Daily active user tracking
  | 'daily_active_user';

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
let sessionStartMs: number = Date.now();
let lastActiveDate: string | undefined;
let cachedGithubUsername: string | null = null;

const libName = 'emdash';

type TelemetryKVSchema = {
  instanceId: string;
  enabled: string;
  onboardingSeen: string;
  lastActiveDate: string;
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
    app_version: getVersionSafe(),
    electron_version: process.versions.electron,
    platform: process.platform,
    arch: process.arch,
    is_dev: !app.isPackaged,
    install_source: installSource ?? (app.isPackaged ? 'dmg' : 'dev'),
    $lib: libName,
    ...(cachedGithubUsername ? { github_username: cachedGithubUsername } : {}),
  };
}

/**
 * Sanitize event properties to prevent PII leakage.
 * Simple allowlist approach: only allow safe property names and primitive types.
 */
function sanitizeEventAndProps(_event: TelemetryEvent, props: Record<string, unknown> | undefined) {
  const sanitized: Record<string, unknown> = {};

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
    'github_username',
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
    'scope',
  ]);

  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (!allowedProps.has(key)) continue;

      if (typeof value === 'string') {
        sanitized[key] = value.trim().slice(0, 100);
      } else if (typeof value === 'number') {
        sanitized[key] = Math.max(0, Math.min(value, 1_000_000));
      } else if (typeof value === 'boolean') {
        sanitized[key] = value;
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

async function posthogIdentify(username: string): Promise<void> {
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
  sessionStartMs = Date.now();

  // Load persisted state from SQLite KV (all reads are non-blocking best-effort)
  let storedInstanceId: string | null = null;
  let storedEnabled: string | null = null;
  let storedOnboarding: string | null = null;
  let storedActiveDate: string | null = null;
  try {
    [storedInstanceId, storedEnabled, storedOnboarding, storedActiveDate] = await Promise.all([
      telemetryKV.get('instanceId'),
      telemetryKV.get('enabled'),
      telemetryKV.get('onboardingSeen'),
      telemetryKV.get('lastActiveDate'),
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

  void posthogCapture('app_started');
  void checkDailyActiveUser();
}

/**
 * Associate the current anonymous session with a known identity (e.g. GitHub
 * username). Call this whenever authentication succeeds — no dynamic imports
 * or polling needed.
 */
export function identify(username: string): void {
  if (!username) return;
  cachedGithubUsername = username;
  void posthogIdentify(username);
}

export function capture(event: TelemetryEvent, properties?: Record<string, unknown>): void {
  if (event === 'app_session') {
    const dur = Math.max(0, Date.now() - (sessionStartMs || Date.now()));
    void posthogCapture(event, { session_duration_ms: dur });
    return;
  }
  void posthogCapture(event, properties);
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

  void posthogCapture('$exception' as TelemetryEvent, {
    $exception_message: errorObj.message || 'Unknown error',
    $exception_type: errorObj.name || 'Error',
    $exception_stack_trace_raw: errorObj.stack || '',
    ...additionalProperties,
  });
}

export function shutdown(): void {
  // No-op — left for future posthog-node batching integration.
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
