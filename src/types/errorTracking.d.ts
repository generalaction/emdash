/**
 * Type definitions for error tracking system
 *
 * These types are used across both main and renderer processes
 * to ensure consistent error context structure.
 */

export type ErrorSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Common error types for categorization
 */
export type ErrorType =
  | 'spawn_error' // PTY/process spawn failures
  | 'git_error' // Git operations
  | 'worktree_error' // Worktree creation/management
  | 'database_error' // Database operations
  | 'network_error' // API calls, network requests
  | 'auth_error' // Authentication failures
  | 'permission_error' // File system permissions
  | 'file_not_found' // Missing files/resources
  | 'render_error' // React rendering errors
  | 'type_error' // JavaScript type errors
  | 'reference_error' // Undefined references
  | 'syntax_error' // Code syntax issues
  | 'api_error' // API response errors
  | 'user_action_error' // User interaction failures
  | 'unhandled_error' // Uncaught exceptions
  | 'unhandled_rejection' // Unhandled promise rejections
  | 'project_error' // Project operations
  | 'github_error' // GitHub API errors
  | 'unknown_error'; // Unclassified errors

/**
 * Main error context structure
 * Used for all error tracking calls
 */
export interface ErrorContext {
  // User identification
  github_username?: string | null;

  // Error classification
  error_type?: ErrorType;
  severity?: ErrorSeverity;

  // Location context
  operation?: string; // What operation was being performed
  service?: string; // Which service threw the error
  component?: string; // Component name (main/renderer/specific)

  // Agent/Task context
  provider?: string; // Agent provider (claude-code, codex, etc.)
  task_id?: string;
  workspace_id?: string;

  // Project context
  project_id?: string;
  project_path?: string;

  // Git/Worktree context
  branch_name?: string;
  worktree_path?: string;
  git_operation?: string;

  // Additional context
  [key: string]: string | number | boolean | null | undefined;
}

/**
 * Main process error tracking service
 */
export interface IErrorTracking {
  init(): Promise<void>;
  captureException(error: Error | unknown, context?: ErrorContext): Promise<void>;
  captureCriticalError(error: Error | unknown, context?: ErrorContext): Promise<void>;
  captureAgentSpawnError(
    error: Error | unknown,
    provider: string,
    taskId: string,
    context?: Partial<ErrorContext>
  ): Promise<void>;
  captureProjectError(
    error: Error | unknown,
    operation: 'create' | 'clone' | 'open' | 'delete',
    projectPath?: string,
    context?: Partial<ErrorContext>
  ): Promise<void>;
  captureWorktreeError(
    error: Error | unknown,
    operation: string,
    worktreePath?: string,
    branchName?: string,
    context?: Partial<ErrorContext>
  ): Promise<void>;
  captureGitHubError(
    error: Error | unknown,
    operation: string,
    context?: Partial<ErrorContext>
  ): Promise<void>;
  captureDatabaseError(
    error: Error | unknown,
    operation: string,
    context?: Partial<ErrorContext>
  ): Promise<void>;
  updateGithubUsername(username: string | null): Promise<void>;
}

/**
 * Renderer process error tracking client
 */
export interface IRendererErrorTracking {
  captureException(error: Error | unknown, context?: ErrorContext): void;
  captureCriticalError(error: Error | unknown, context?: ErrorContext): void;
  captureApiError(
    error: Error | unknown,
    endpoint: string,
    operation: string,
    context?: Partial<ErrorContext>
  ): void;
  captureComponentError(
    error: Error | unknown,
    componentName: string,
    context?: Partial<ErrorContext>
  ): void;
  captureUserActionError(
    error: Error | unknown,
    action: string,
    context?: Partial<ErrorContext>
  ): void;
}

/**
 * Common error operations for context
 */
export type ErrorOperation =
  // Agent operations
  | 'agent_spawn'
  | 'agent_kill'
  | 'agent_resize'

  // Project operations
  | 'project_create'
  | 'project_clone'
  | 'project_open'
  | 'project_delete'

  // Worktree operations
  | 'worktree_create'
  | 'worktree_delete'
  | 'worktree_list'

  // GitHub operations
  | 'github_auth'
  | 'github_poll_device_code'
  | 'github_get_user'
  | 'github_create_pr'
  | 'github_api_call'

  // Database operations
  | 'db_connect'
  | 'db_migrate'
  | 'db_query'
  | 'db_insert'
  | 'db_update'
  | 'db_delete'

  // PTY operations
  | 'pty_spawn'
  | 'pty_spawn_fallback'
  | 'pty_write'
  | 'pty_resize'
  | 'pty_kill';

/**
 * Services that can generate errors
 */
export type ErrorService =
  | 'ptyManager'
  | 'WorktreeService'
  | 'GitHubService'
  | 'DatabaseService'
  | 'GitService'
  | 'projectIpc'
  | 'appIpc'
  | 'gitIpc'
  | 'githubIpc'
  | 'ptyIpc'
  | 'renderer'
  | 'unknown';
