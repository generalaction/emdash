import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import type { Logger } from '@emdash/shared/logger';
import type { ProjectAttachmentManager } from '@core/features/projects/api/node/project-attachment-manager';
import type { TaskService } from '@core/features/tasks/api/node/task-service';
import type { WorkspaceIdentityService } from '@core/features/workspaces/api/node/workspace-identity-service';
import type { TelemetryService } from '@core/primitives/telemetry/api/telemetry';
import type { AppDb } from '@core/services/app-db/node/db';
import type { AppSettingsService } from '@core/services/settings/node';

/**
 * Everything the Emdash MCP tools need, injected from the boot composition root.
 * The tools own no singletons of their own so they stay testable and so the
 * slice's node layer keeps the same dependency shape as its wire controller.
 */
export type McpToolDependencies = Readonly<{
  db: AppDb;
  projects: ProjectAttachmentManager;
  tasks: TaskService;
  runtimes: RuntimeBroker;
  workspaceIdentity: WorkspaceIdentityService;
  appSettings: AppSettingsService;
  telemetry: TelemetryService;
  logger: Logger;
  /** Reported as the MCP server's version. */
  appVersion: string;
  /** Starts a task's initial conversation once its workspace is provisioned. */
  startInitialConversation: StartInitialConversation;
}>;

export type StartInitialConversation = (input: {
  projectId: string;
  taskId: string;
  conversationId: string;
  type: 'pty' | 'acp';
}) => Promise<{ started: boolean; message?: string }>;
