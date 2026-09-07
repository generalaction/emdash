import { emdashConfigSchema } from '@emdash/core/primitives/emdash-config/api';
import { hostRefEquals } from '@emdash/core/primitives/host/api';
import { hostFileRef } from '@emdash/core/primitives/path/api';
import type { AutomationDeployment } from '@emdash/core/runtimes/automations/api';
import { err, ok, type Result } from '@emdash/shared';
import { eq } from 'drizzle-orm';
import { storedGitSettingsFromRow } from '@core/features/projects/api/node/settings/effective-settings';
import type { WorkspaceIdentity } from '@core/features/workspaces/api/node/workspace-identity-service';
import type { Automation, AutomationDefinitionError } from '@core/primitives/automations/api';
import { getLocalTimeZone } from '@core/primitives/automations/api';
import { hostPathFromNative } from '@core/primitives/desktop-runtime/api';
import { resolveEffectiveSettings, type RepoFacts } from '@core/primitives/project-settings/api';
import { projectHostRef, type Project } from '@core/primitives/projects/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { projectSettings } from '@core/services/app-db/node/schema';

type DeploymentProjectSettings = {
  baseRemote: string | null;
  preservePatterns: string[];
  pushRemote: string | null;
};

export async function buildAutomationDeployment(
  dependencies: {
    db: AppDb;
    getProjectById(projectId: string): Promise<Project | undefined>;
    /** Repository facts for the blessed resolver; null degrades to inference-less resolution. */
    getRepoFacts(project: Project): Promise<RepoFacts | null>;
    resolveWorkspace(workspaceId: string): Promise<WorkspaceIdentity | null>;
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
  const projectHost = projectHostRef(project);

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
  const settings = await loadDeploymentProjectSettings(dependencies, project);

  let workspace: AutomationDeployment['workspace'];
  if (taskWorkspace.workspace.kind === 'new-worktree') {
    // Effective values through the blessed resolver (spec: github-git-settings
    // §2); a repository without remotes cannot run worktree automations.
    const baseRemote = settings.baseRemote;
    if (baseRemote === null) {
      return err({
        type: 'workspace-not-supported',
        message: 'The project repository has no git remotes; worktree automations need one.',
      });
    }
    const pool = await dependencies.resolveWorktreePool(project);
    if (!pool.success) return err(runtimeUnavailable(pool.error));
    if (taskWorkspace.git.kind === 'create-branch') {
      workspace = {
        kind: 'worktree',
        repository: hostFileRef(projectHost, hostPathFromNative(project.path)),
        worktreePoolPath: hostPathFromNative(pool.data),
        baseRemote,
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
        repository: hostFileRef(projectHost, hostPathFromNative(project.path)),
        worktreePoolPath: hostPathFromNative(pool.data),
        baseRemote,
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
    const resolved =
      (await dependencies.resolveWorkspace(workspaceId)) ??
      (workspaceId === project.repositoryWorkspaceId
        ? { workspaceId, host: projectHost, path: project.path, projectId: project.id }
        : null);
    if (!resolved) {
      return err({
        type: 'workspace-not-found',
        workspaceId,
        message: 'The selected workspace no longer exists.',
      });
    }
    if (resolved.projectId !== project.id || !hostRefEquals(resolved.host, projectHost)) {
      return err({
        type: 'workspace-not-supported',
        message: 'The selected workspace belongs to a different runtime host.',
      });
    }
    workspace = {
      kind: 'directory',
      path: hostFileRef(resolved.host, hostPathFromNative(resolved.path)),
    };
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

/**
 * Effective base/push remote for a deployment through the blessed resolver
 * (spec: github-git-settings §2) over the stored row (migrated in memory,
 * no write-back) and the injected repository facts. It reads desktop-owned
 * settings directly so Project-context and Host-attachment timing cannot
 * block boot.
 */
async function loadDeploymentProjectSettings(
  dependencies: Parameters<typeof buildAutomationDeployment>[0],
  project: Project
): Promise<DeploymentProjectSettings> {
  const [row] = await dependencies.db
    .select({
      base: projectSettings.baseProjectSettingsJson,
      shareable: projectSettings.shareableProjectSettingsJson,
    })
    .from(projectSettings)
    .where(eq(projectSettings.projectId, project.id))
    .limit(1);

  const facts = await dependencies.getRepoFacts(project);
  let stored = {};
  let preservePatterns: string[] = [];
  if (row) {
    try {
      stored = storedGitSettingsFromRow(row.base, facts);
      preservePatterns = emdashConfigSchema.parse(JSON.parse(row.shareable)).preservePatterns ?? [];
    } catch {
      stored = {};
    }
  }

  const effective = resolveEffectiveSettings(
    // The worktree pool comes from resolveWorktreePool, so the resolver's
    // worktreeRoot output is unused here.
    { project: stored, builtInWorktreeRoot: '' },
    facts ?? { remotes: [], localBranches: [] },
    []
  );
  return {
    baseRemote: effective.baseRemote.value,
    preservePatterns,
    pushRemote: effective.pushRemote.value,
  };
}
