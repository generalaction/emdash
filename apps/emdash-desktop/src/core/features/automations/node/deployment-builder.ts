import type { AutomationDeployment } from '@emdash/core/runtimes/automations/api';
import { err, ok, type Result } from '@emdash/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Automation, AutomationDefinitionError } from '@core/primitives/automations/api';
import { getLocalTimeZone } from '@core/primitives/automations/api';
import { hostFileRefFromNativePath } from '@core/primitives/desktop-runtime/api';
import { hostPathFromNative } from '@core/primitives/desktop-runtime/api';
import {
  baseProjectSettingsSchema,
  DEFAULT_PRESERVE_PATTERNS,
  legacyBaseProjectSettingsSchema,
  shareableProjectSettingsSchema,
} from '@core/primitives/project-settings/api';
import type { Project } from '@core/primitives/projects/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { projectSettings, workspaces } from '@core/services/app-db/node/schema';

type DeploymentProjectSettings = {
  baseRemote: string;
  preservePatterns: string[];
  pushRemote: string;
};

export async function buildAutomationDeployment(
  dependencies: {
    db: AppDb;
    getProjectById(projectId: string): Promise<Project | undefined>;
    resolveWorktreePool(project: Project): Promise<Result<string, { message: string }>>;
  },
  automation: Automation
): Promise<Result<AutomationDeployment, AutomationDefinitionError>> {
  try {
    return await buildAutomationDeploymentOnce(dependencies, automation);
  } catch (error) {
    return err(runtimeUnavailable(error));
  }
}

async function buildAutomationDeploymentOnce(
  dependencies: Parameters<typeof buildAutomationDeployment>[0],
  automation: Automation
): Promise<Result<AutomationDeployment, AutomationDefinitionError>> {
  if (!automation.projectId) {
    return err({
      type: 'invalid-definition',
      reason: 'automation_not_configured',
      message: 'Attach the automation to a project before deploying it.',
    });
  }
  if (!automation.triggerConfig || !automation.conversationConfig || !automation.taskConfig) {
    return err({
      type: 'invalid-definition',
      reason: 'automation_not_configured',
      message: 'Finish configuring the automation before saving.',
    });
  }

  const project = await dependencies.getProjectById(automation.projectId);
  if (!project) {
    return err({
      type: 'project-not-found',
      projectId: automation.projectId,
      message: 'The selected project no longer exists.',
    });
  }
  if (project.type === 'ssh') {
    return err({
      type: 'runtime-unavailable',
      message: 'The remote automation runtime cannot be reached.',
    });
  }

  const conversation = automation.conversationConfig;
  const prompt = conversation.prompt.trim();
  if (!prompt) {
    return err({
      type: 'invalid-definition',
      reason: 'conversation_config_prompt_required',
      message: 'Add a prompt before saving.',
    });
  }

  const taskWorkspace = automation.taskConfig.workspaceConfig;
  const settings = await loadDeploymentProjectSettings(dependencies.db, project.id);
  const pool = await dependencies.resolveWorktreePool(project);
  if (!pool.success) return err(runtimeUnavailable(pool.error));

  let workspace: AutomationDeployment['workspace'];
  if (taskWorkspace.workspace.kind === 'new-worktree') {
    if (taskWorkspace.git.kind === 'create-branch') {
      workspace = {
        kind: 'worktree',
        repository: hostFileRefFromNativePath(project.path),
        worktreePoolPath: hostPathFromNative(pool.data),
        baseRemote: settings.baseRemote,
        preservePatterns: settings.preservePatterns,
        git: {
          kind: 'create-branch',
          fromBranch: taskWorkspace.git.fromBranch,
          pushRemote: taskWorkspace.git.pushBranch ? settings.pushRemote : null,
        },
      };
    } else if (taskWorkspace.git.kind === 'use-branch') {
      workspace = {
        kind: 'worktree',
        repository: hostFileRefFromNativePath(project.path),
        worktreePoolPath: hostPathFromNative(pool.data),
        baseRemote: settings.baseRemote,
        preservePatterns: settings.preservePatterns,
        git: { kind: 'use-branch', branchName: taskWorkspace.git.branchName },
      };
    } else {
      return err({
        type: 'workspace-not-supported',
        message: 'This workspace type cannot run an automation yet.',
      });
    }
  } else if (taskWorkspace.workspace.kind === 'repository-instance') {
    const workspaceId = taskWorkspace.workspace.workspaceId;
    const [workspaceRow] = await dependencies.db
      .select({ location: workspaces.location, path: workspaces.path, type: workspaces.type })
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
      .limit(1);
    const path =
      workspaceRow?.path ?? (workspaceId === project.repositoryWorkspaceId ? project.path : null);
    if (!path) {
      return err({
        type: 'workspace-not-found',
        workspaceId,
        message: 'The selected workspace no longer exists.',
      });
    }
    if (workspaceRow?.location === 'remote' || workspaceRow?.type === 'project-ssh') {
      return err({
        type: 'runtime-unavailable',
        message: 'The remote automation runtime cannot be reached.',
      });
    }
    workspace = { kind: 'directory', path: hostFileRefFromNativePath(path) };
  } else {
    return err({
      type: 'workspace-not-supported',
      message: 'This workspace type cannot run an automation yet.',
    });
  }

  const model = conversation.model?.trim() || null;
  const title = conversation.title?.trim() || automation.name.trim();
  const agent: AutomationDeployment['agent'] =
    conversation.type === 'acp'
      ? {
          type: 'acp',
          start: {
            providerId: conversation.provider,
            model,
            initialQueue: [{ text: prompt }],
          },
          title,
        }
      : {
          type: 'tui',
          start: {
            providerId: conversation.provider,
            model,
            initialPrompt: prompt,
            autoApprove: conversation.autoApprove,
          },
          title,
        };

  return ok({
    automationId: automation.id,
    revision: automation.revision,
    enabled: automation.enabled,
    name: automation.name.trim(),
    schedule: {
      expr: automation.triggerConfig.expr.trim(),
      tz: automation.triggerConfig.tz?.trim() || getLocalTimeZone(),
    },
    agent,
    workspace,
  });
}

function runtimeUnavailable(error: unknown): AutomationDefinitionError {
  return {
    type: 'runtime-unavailable',
    message: error instanceof Error ? error.message : String(error),
  };
}

async function loadDeploymentProjectSettings(
  db: AppDb,
  projectId: string
): Promise<DeploymentProjectSettings> {
  const [row] = await db
    .select({
      base: projectSettings.baseProjectSettingsJson,
      shareable: projectSettings.shareableProjectSettingsJson,
    })
    .from(projectSettings)
    .where(eq(projectSettings.projectId, projectId))
    .limit(1);

  if (!row) {
    return {
      baseRemote: 'origin',
      preservePatterns: [...DEFAULT_PRESERVE_PATTERNS],
      pushRemote: 'origin',
    };
  }

  try {
    const legacyBase = legacyBaseProjectSettingsSchema.parse(JSON.parse(row.base));
    const { remote, ...withoutLegacyRemote } = legacyBase;
    const base = baseProjectSettingsSchema.parse({
      ...withoutLegacyRemote,
      baseRemote: withoutLegacyRemote.baseRemote ?? remote,
    });
    const shareable = shareableProjectSettingsSchema.parse(JSON.parse(row.shareable));
    return {
      baseRemote: base.baseRemote ?? 'origin',
      preservePatterns: shareable.preservePatterns ?? [...DEFAULT_PRESERVE_PATTERNS],
      pushRemote: base.pushRemote ?? base.baseRemote ?? 'origin',
    };
  } catch {
    return {
      baseRemote: 'origin',
      preservePatterns: [...DEFAULT_PRESERVE_PATTERNS],
      pushRemote: 'origin',
    };
  }
}
