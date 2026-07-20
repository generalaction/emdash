import type { AutomationDeployment } from '@emdash/core/runtimes/automations/api';
import { and, eq, isNull } from 'drizzle-orm';
import type { Automation } from '@core/primitives/automations/api';
import { getLocalTimeZone } from '@core/primitives/automations/api';
import { hostFileRefFromNativePath } from '@core/primitives/desktop-runtime/api';
import { hostPathFromNative } from '@core/primitives/desktop-runtime/api';
import {
  baseProjectSettingsSchema,
  DEFAULT_PRESERVE_PATTERNS,
  legacyBaseProjectSettingsSchema,
  shareableProjectSettingsSchema,
} from '@core/primitives/project-settings/api';
import { getProjectById } from '@main/core/projects/operations/getProjects';
import { workspacePlacementResolver } from '@main/core/workspaces/placement/workspace-placement-resolver';
import { db } from '@main/db/client';
import { projectSettings, workspaces } from '@main/db/schema';

type DeploymentProjectSettings = {
  baseRemote: string;
  preservePatterns: string[];
  pushRemote: string;
};

export async function buildAutomationDeployment(
  automation: Automation
): Promise<AutomationDeployment> {
  if (!automation.projectId) throw new Error('no_project_attached');
  if (!automation.triggerConfig || !automation.conversationConfig || !automation.taskConfig) {
    throw new Error('automation_not_configured');
  }

  const project = await getProjectById(automation.projectId);
  if (!project) throw new Error('project_not_found');
  if (project.type === 'ssh') {
    throw new Error('The remote automation runtime cannot be reached.');
  }

  const conversation = automation.conversationConfig;
  const prompt = conversation.prompt.trim();
  if (!prompt) throw new Error('conversation_config_prompt_required');

  const taskWorkspace = automation.taskConfig.workspaceConfig;
  const settings = await loadDeploymentProjectSettings(project.id);
  const pool = await workspacePlacementResolver.resolveWorktreePool(project);
  if (!pool.success) throw new Error(pool.error.message);
  const workspace: AutomationDeployment['workspace'] = await (async () => {
    if (taskWorkspace.workspace.kind === 'new-worktree') {
      if (taskWorkspace.git.kind === 'create-branch') {
        return {
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
      }
      if (taskWorkspace.git.kind === 'use-branch') {
        return {
          kind: 'worktree',
          repository: hostFileRefFromNativePath(project.path),
          worktreePoolPath: hostPathFromNative(pool.data),
          baseRemote: settings.baseRemote,
          preservePatterns: settings.preservePatterns,
          git: { kind: 'use-branch', branchName: taskWorkspace.git.branchName },
        };
      }
      throw new Error('automation_workspace_not_supported');
    }

    if (taskWorkspace.workspace.kind === 'repository-instance') {
      const [workspaceRow] = await db
        .select({ location: workspaces.location, path: workspaces.path, type: workspaces.type })
        .from(workspaces)
        .where(
          and(eq(workspaces.id, taskWorkspace.workspace.workspaceId), isNull(workspaces.deletedAt))
        )
        .limit(1);
      const path =
        workspaceRow?.path ??
        (taskWorkspace.workspace.workspaceId === project.repositoryWorkspaceId
          ? project.path
          : null);
      if (!path) throw new Error('automation_workspace_not_found');
      if (workspaceRow?.location === 'remote' || workspaceRow?.type === 'project-ssh') {
        throw new Error('The remote automation runtime cannot be reached.');
      }
      return { kind: 'directory', path: hostFileRefFromNativePath(path) };
    }

    throw new Error('automation_workspace_not_supported');
  })();

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

  return {
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
  };
}

async function loadDeploymentProjectSettings(
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
