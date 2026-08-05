import type { AgentProviderId } from '@emdash/plugins/agents';
import type {
  AutomationRunStatus,
  AutomationRunTriggerKind,
} from '@shared/core/automations/automation-run';
import type { PullRequestMergeStrategy } from '@shared/core/pull-requests/pull-requests';
import type { TaskLifecycleStatus } from '@shared/core/tasks/tasks';
import type { OpenInAppId } from '@shared/openInApps';

type EmptyProps = Record<string, never>;

export type FocusView =
  | 'home'
  | 'project'
  | 'task'
  | 'settings'
  | 'library'
  | 'skills'
  | 'mcp'
  | 'automations';
export type FocusMainPanel = 'agents' | 'editor' | 'diff' | 'browser' | 'terminal';
export type FocusedRegion = 'main' | 'bottom';

export type FocusTrigger = 'navigation' | 'panel_switch' | 'region_switch';

export interface TelemetryEnvelope {
  event_ts_ms?: number;
  session_id?: string;
  automation_id?: string;
  project_id?: string;
  task_id?: string;
  conversation_id?: string;
}

export type TelemetryExceptionReport = {
  name: string;
  message: string;
  stack?: string;
  componentStack?: string;
  mechanism: 'react' | 'window_error' | 'unhandled_rejection' | 'bootstrap';
};

export interface FocusContext {
  active_view: FocusView | null;
  active_main_panel: FocusMainPanel | null;
  focused_region: FocusedRegion | null;
}

export type SettingName = 'theme' | 'default_provider' | 'telemetry' | 'notifications';

export type TelemetryEventProperties = {
  app_started: EmptyProps;
  app_closed: { was_unclean_exit?: boolean };
  app_window_focused: EmptyProps;
  app_window_unfocused: EmptyProps;
  daily_active_user: { date: string; timezone: string };

  focus_changed: {
    view: FocusView | null;
    main_panel: FocusMainPanel | null;
    focused_region: FocusedRegion | null;
    trigger: FocusTrigger;
  };

  home_viewed: { from_view: FocusView | null };
  project_viewed: { from_view: FocusView | null };
  task_viewed: { from_view: FocusView | null };
  settings_viewed: { from_view: FocusView | null };
  library_viewed: { from_view: FocusView | null };
  skills_viewed: { from_view: FocusView | null };
  mcp_viewed: { from_view: FocusView | null };
  automations_viewed: { from_view: FocusView | null };

  automation_created: {
    enabled: boolean;
    trigger_kind: 'cron';
    provider: AgentProviderId | null;
    has_initial_prompt: boolean;
  };
  automation_enabled_changed: { enabled: boolean; trigger_kind: 'cron' };
  automation_run_started: { trigger_kind: AutomationRunTriggerKind };
  automation_run_completed: {
    status: Extract<AutomationRunStatus, 'done' | 'failed' | 'skipped'>;
    trigger_kind: AutomationRunTriggerKind;
    duration_ms?: number;
    task_id?: string;
    error_step?: string;
    error_code?: string;
  };

  project_added: { type: 'local' | 'ssh'; strategy: 'open' | 'create' | 'clone'; success: boolean };
  project_deleted: EmptyProps;

  task_created: {
    strategy: 'blank' | 'branch' | 'issue' | 'pr';
    has_initial_prompt: boolean;
    has_issue:
      | 'github'
      | 'linear'
      | 'jira'
      | 'gitlab'
      | 'plane'
      | 'plain'
      | 'forgejo'
      | 'featurebase'
      | 'asana'
      | 'none';
    provider: AgentProviderId | null;
  };
  task_provisioned: EmptyProps;
  task_archived: EmptyProps;
  task_status_changed: { from_status: TaskLifecycleStatus; to_status: TaskLifecycleStatus };
  task_deleted: EmptyProps;

  conversation_created: { provider: AgentProviderId; is_first_in_task: boolean };
  conversation_deleted: EmptyProps;
  agent_run_started: { provider: AgentProviderId };

  terminal_created: { terminal_id: string };
  terminal_deleted: { terminal_id: string };

  pr_created: { is_draft: boolean };
  pr_creation_failed: { error_type: string };
  pr_merged: {
    strategy: PullRequestMergeStrategy;
    bypass_requirements: boolean;
    success: boolean;
    error_type?: string;
  };

  vcs_branch_published: { success: boolean; error_type?: string };
  vcs_fetch: { success: boolean; error_type?: string };
  vcs_push: { success: boolean; error_type?: string };
  vcs_pull: { success: boolean; strategy?: string; conflicts?: boolean; error_type?: string };
  vcs_files_staged: { count: number; scope: 'single' | 'multiple' | 'all' };
  vcs_files_unstaged: { count: number; scope: 'single' | 'multiple' | 'all' };
  vcs_files_discarded: { count: number; scope: 'single' | 'multiple' | 'all' };

  user_signed_in: EmptyProps;
  user_signed_out: EmptyProps;

  integration_connected: { provider: 'github' | 'linear' | 'jira' | 'asana' };
  integration_disconnected: { provider: 'github' | 'linear' | 'jira' | 'asana' };
  issue_linked_to_task: {
    provider:
      | 'github'
      | 'linear'
      | 'jira'
      | 'gitlab'
      | 'plane'
      | 'plain'
      | 'forgejo'
      | 'featurebase'
      | 'asana';
  };

  open_in_external: { app: OpenInAppId | 'browser' };
  ssh_connection_attempted: { success: boolean };

  mcp_server_added: { source: 'catalog' | 'custom' };
  mcp_server_removed: EmptyProps;

  skill_installed: { source?: string };
  skill_uninstalled: EmptyProps;
  skill_created: EmptyProps;

  setting_changed: { setting: SettingName };
  sidebar_toggled: { side: 'left' | 'right'; state: 'open' | 'closed' };

  error: { error_type: string; scope: string };
};

export type TelemetryEvent = keyof TelemetryEventProperties;
export type TelemetryProperties<E extends TelemetryEvent> = TelemetryEventProperties[E] &
  TelemetryEnvelope;
