import { ipcMain } from 'electron';
import {
  capture,
  captureException,
  isTelemetryEnabled,
  getTelemetryStatus,
  setTelemetryEnabledViaUser,
  setOnboardingSeen,
} from '../telemetry';

// Events allowed from renderer process
// Main process-only events (app_started, app_closed, app_window_focused, github_connection_triggered,
// github_connected, task_snapshot, app_session, agent_run_start, agent_run_finish) should NOT be here
const RENDERER_ALLOWED_EVENTS = new Set([
  // Error tracking
  '$exception', // PostHog error tracking format
  // Legacy
  'feature_used',
  'error',
  // Project management
  'project_add_clicked',
  'project_open_clicked',
  'project_added_success',
  'project_deleted',
  'project_view_opened',
  // Task management
  'task_created',
  'task_deleted',
  'task_provider_switched',
  'task_custom_named',
  'task_advanced_options_opened',
  // Terminal (Right Sidebar)
  'terminal_entered',
  'terminal_command_executed',
  'terminal_new_terminal_created',
  'terminal_deleted',
  // Changes (Right Sidebar)
  'changes_viewed',
  // Plan mode
  'plan_mode_enabled',
  'plan_mode_disabled',
  // Git & Pull Requests
  'pr_created',
  'pr_creation_failed',
  'pr_viewed',
  // Linear integration
  'linear_connected',
  'linear_disconnected',
  'linear_issues_searched',
  'linear_issue_selected',
  // Jira integration
  'jira_connected',
  'jira_disconnected',
  'jira_issues_searched',
  'jira_issue_selected',
  // Container & Dev Environment
  'container_connect_clicked',
  'container_connect_success',
  'container_connect_failed',
  // ToolBar Section
  'toolbar_feedback_clicked',
  'toolbar_left_sidebar_clicked',
  'toolbar_right_sidebar_clicked',
  'toolbar_settings_clicked',
  'toolbar_open_in_menu_clicked',
  'toolbar_open_in_selected',
  'toolbar_kanban_toggled',
  // Browser Preview
  'browser_preview_closed',
  'browser_preview_url_navigated',
  // Settings & Preferences
  'settings_tab_viewed',
  'theme_changed',
  'telemetry_toggled',
  'notification_settings_changed',
  'default_provider_changed',
]);

export function registerTelemetryIpc() {
  ipcMain.handle('telemetry:capture', async (_event, args: { event: string; properties?: any }) => {
    try {
      if (!isTelemetryEnabled()) return { success: false, disabled: true };
      const ev = String(args?.event || '') as any;
      if (!RENDERER_ALLOWED_EVENTS.has(ev)) {
        return { success: false, error: 'event_not_allowed' };
      }
      const props =
        args?.properties && typeof args.properties === 'object' ? args.properties : undefined;

      // Handle $exception events specially for PostHog error tracking
      if (ev === '$exception') {
        // Extract error details from properties
        const errorMessage = props?.$exception_message || 'Unknown error';
        const error = new Error(errorMessage);
        error.stack = props?.$exception_stack_trace_raw || '';
        error.name = props?.$exception_type || 'Error';

        // Call captureException with the error and additional properties
        captureException(error, props);
      } else {
        // Regular telemetry events
        capture(ev, props);
      }

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || 'capture_failed' };
    }
  });

  ipcMain.handle('telemetry:get-status', async () => {
    try {
      return { success: true, status: getTelemetryStatus() };
    } catch (e: any) {
      return { success: false, error: e?.message || 'status_failed' };
    }
  });

  ipcMain.handle('telemetry:set-enabled', async (_event, enabled: boolean) => {
    try {
      setTelemetryEnabledViaUser(Boolean(enabled));
      return { success: true, status: getTelemetryStatus() };
    } catch (e: any) {
      return { success: false, error: e?.message || 'update_failed' };
    }
  });

  ipcMain.handle('telemetry:set-onboarding-seen', async (_event, flag: boolean) => {
    try {
      setOnboardingSeen(Boolean(flag));
      return { success: true, status: getTelemetryStatus() };
    } catch (e: any) {
      return { success: false, error: e?.message || 'update_failed' };
    }
  });
}
