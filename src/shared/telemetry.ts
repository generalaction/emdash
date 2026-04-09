import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { OpenInAppId } from '@shared/openInApps';
import type { TaskLifecycleStatus } from '@shared/tasks';

type EmptyProps = Record<string, never>;

export type FocusView = 'home' | 'project' | 'task' | 'settings' | 'skills' | 'mcp';
export type FocusMainPanel = 'agents' | 'editor' | 'diff';
export type FocusRightPanel = 'changes' | 'terminals' | 'files';
export type FocusedRegion = 'main' | 'right';

export type FocusTrigger =
  | 'navigation'
  | 'panel_switch'
  | 'region_switch'
  | 'tab_switch'
  | 'window_blur'
  | 'window_focus'
  | 'modal_open'
  | 'modal_close'
  | 'app_quit';

export interface FocusContext {
  active_view: FocusView | null;
  active_main_panel: FocusMainPanel | null;
  active_right_panel: FocusRightPanel | null;
  focused_region: FocusedRegion | null;
  conversation_index: number | null;
  time_in_view_ms: number;
  session_duration_ms: number;
}

export type SettingName = 'theme' | 'default_provider' | 'telemetry' | 'notifications';

export type TelemetryEventProperties = {
  app_started: EmptyProps;
  app_closed: EmptyProps;
  app_window_focused: EmptyProps;
  app_session: { session_duration_ms?: number };
  daily_active_user: { date: string; timezone: string };

  focus_changed: {
    view: FocusView | null;
    main_panel: FocusMainPanel | null;
    right_panel: FocusRightPanel | null;
    focused_region: FocusedRegion | null;
    conversation_index: number | null;
    duration_ms: number;
    trigger: FocusTrigger;
  };

  home_viewed: { from_view: FocusView | null; dwell_ms: number };
  project_viewed: { from_view: FocusView | null; dwell_ms: number };
  task_viewed: { from_view: FocusView | null; dwell_ms: number };
  settings_viewed: { from_view: FocusView | null; dwell_ms: number };
  skills_viewed: { from_view: FocusView | null; dwell_ms: number };
  mcp_viewed: { from_view: FocusView | null; dwell_ms: number };

  modal_opened: { modal_id: string };
  modal_closed: { modal_id: string; outcome: 'completed' | 'dismissed'; duration_ms: number };

  project_added: { source: 'open' | 'create' | 'clone' | 'ssh'; success: boolean };
  project_deleted: EmptyProps;

  task_created: {
    has_initial_prompt: boolean;
    has_issue: 'github' | 'linear' | 'jira' | 'gitlab' | 'plain' | 'forgejo' | 'none';
    provider: AgentProviderId | null;
  };
  task_status_changed: { from_status: TaskLifecycleStatus; to_status: TaskLifecycleStatus };
  task_deleted: EmptyProps;

  conversation_created: { provider: AgentProviderId; is_first_in_task: boolean };
  agent_run_started: { provider: AgentProviderId };
  agent_run_finished: { provider: AgentProviderId; duration_ms: number; exit_code: number };

  pr_created: { is_draft: boolean };
  pr_creation_failed: { error_type: string };

  integration_connected: { provider: 'github' | 'linear' | 'jira' };
  integration_disconnected: { provider: 'github' | 'linear' | 'jira' };
  issue_linked_to_task: { provider: 'github' | 'linear' | 'jira' | 'gitlab' | 'plain' | 'forgejo' };

  open_in_external: { app: OpenInAppId | 'browser' };
  ssh_connection_attempted: { success: boolean };

  mcp_server_added: { source: 'catalog' | 'custom' };
  mcp_server_removed: EmptyProps;

  skill_installed: { source?: string };
  skill_uninstalled: EmptyProps;
  skill_created: EmptyProps;

  setting_changed: { setting: SettingName };
  sidebar_toggled: { side: 'left' | 'right'; state: 'open' | 'closed' };

  $exception: {
    $exception_message: string;
    $exception_type: string;
    $exception_stack_trace_raw: string;
    $exception_fingerprint?: string;
    severity?: 'low' | 'medium' | 'high' | 'critical';
    component?: string;
    action?: string;
    user_action?: string;
    operation?: string;
    endpoint?: string;
    session_errors?: number;
    error_timestamp?: string;
    error_type?: string;
  };
  error: { error_type: string; scope: string };

  task_snapshot: { task_count_bucket: string; project_count_bucket: string };
  db_setup: { applied_migrations_bucket: string; recovered: boolean };
};

export type TelemetryEvent = keyof TelemetryEventProperties;
