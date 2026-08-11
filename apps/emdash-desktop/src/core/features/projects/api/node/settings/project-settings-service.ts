import type { ProjectConfigState } from '@emdash/core/runtimes/workspace-registry/api';
import { err, ok, type Result } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import type { LiveSource } from '@emdash/wire/rpc';
import type { ProjectSessionManager } from '@core/features/projects/api/node/project-manager';
import type { ProjectProvider } from '@core/features/projects/api/node/project-provider';
import type { StoredPlacementSettings } from '@core/features/projects/api/node/settings/provider';
import { projectEvents } from '@core/features/projects/node';
import { getProjectConfigEnsuringRegistration } from '@core/features/workspaces/api/node/registry-verbs';
import type { WorkspaceIdentityService } from '@core/features/workspaces/api/node/workspace-identity-service';
import { HookCore, type Hookable } from '@core/primitives/hooks/api/hookable';
import {
  type MigrateProjectConfigRequest,
  type ProjectSettings,
  type ProjectSettingsWriteTargetOption,
  type StoredProjectGitSettings,
  type WorktreeRootContext,
  type WriteProjectConfigRequest,
} from '@core/primitives/project-settings/api';
import {
  hasConfiguredShareableProjectSettings,
  resolveWorktreeRoot,
  tombstonePatchFor,
} from '@core/primitives/project-settings/api';
import type { UpdateProjectSettingsError } from '@core/primitives/projects/api';
import type { AppDb } from '@core/services/app-db/node/db';
import {
  inspectProjectConfigMigrations,
  migrateProjectConfigFromProvider,
} from '../../../node/settings/sharing/config-migration';
import {
  getProjectSettingsWriteTargets,
  resolveAllProjectSettingsTargets,
  resolveProjectSettingsTarget,
} from '../../../node/settings/sharing/project-settings-target-resolver';
import { shareProjectSettingsToConfig as writeSharedProjectSettingsToConfig } from '../../../node/settings/sharing/share-project-settings-to-config';
import {
  projectConfigDomainsFromState,
  type MigrateProjectConfigResult,
  type ProjectSettingsDomainPatch,
  type ProjectSettingsDomains,
  type ProjectSettingsPage,
} from '../../project-settings-page';

export type ProjectSettingsHooks = {
  'project-settings:changed': (event: {
    projectId: string;
    settings: ProjectSettings;
  }) => void | Promise<void>;
};

export class ProjectSettingsService implements Hookable<ProjectSettingsHooks> {
  private readonly _hooks = new HookCore<ProjectSettingsHooks>((name, e) =>
    log.error(`ProjectSettingsService: ${String(name)} hook error`, { error: e })
  );
  private _disposeRendererBridge: (() => void) | null = null;

  constructor(
    private readonly dependencies: {
      db: AppDb;
      projects: Pick<ProjectSessionManager, 'getProject'>;
      workspaceIdentity: WorkspaceIdentityService;
    }
  ) {}

  on<K extends keyof ProjectSettingsHooks>(name: K, handler: ProjectSettingsHooks[K]) {
    return this._hooks.on(name, handler);
  }

  initialize(): void {
    this._disposeRendererBridge?.();
    this._disposeRendererBridge = this.on('project-settings:changed', ({ projectId }) => {
      projectEvents.emit(undefined, { type: 'settings-changed', projectId });
    });
  }

  async getProjectConfigLiveSource(projectId: string): Promise<LiveSource> {
    const project = this.requireProject(projectId);
    if (!project.success) throw new Error(`Project '${projectId}' was not found`);
    const workspaceId = project.data.project.repositoryWorkspaceId;
    if (!workspaceId) throw new Error(`Project '${projectId}' has no repository workspace`);
    return project.data.workspaceRegistry.projectConfig
      .state({ workspaceId }, 'current')
      .asLiveSource();
  }

  async getProjectSettingsPage(
    projectId: string
  ): Promise<Result<ProjectSettingsPage, UpdateProjectSettingsError>> {
    const project = this.requireProject(projectId);
    if (!project.success) return project;
    return this.getProjectSettingsPageForProject(project.data);
  }

  async updateProjectSettings(
    projectId: string,
    patch: ProjectSettingsDomainPatch
  ): Promise<Result<ProjectSettingsPage, UpdateProjectSettingsError>> {
    const project = this.requireProject(projectId);
    if (!project.success) return project;

    const personalPatch = {
      ...patch.lifecycle?.personal,
      ...patch.fileHandling?.personal,
    };
    if (Object.keys(personalPatch).length > 0) {
      const workspaceId = project.data.project.repositoryWorkspaceId;
      if (!workspaceId) return err({ type: 'error' });
      const result = await project.data.workspaceRegistry.patchPersonalProjectConfig({
        workspaceId,
        patch: personalPatch,
      });
      if (!result.success) return err({ type: 'error' });
    }

    if (patch.gitIdentity || patch.placement) {
      const result = await project.data.settings.patch({
        ...(patch.gitIdentity ? { gitIdentity: patch.gitIdentity } : {}),
        ...(patch.placement ? { placement: patch.placement } : {}),
      });
      if (!result.success) return result;
    }

    const page = await this.getProjectSettingsPageForProject(project.data);
    if (!page.success) return page;
    this.emitSettingsChanged(projectId, await project.data.settings.get());
    return page;
  }

  async shareProjectSettingsToConfig(
    projectId: string,
    request: WriteProjectConfigRequest
  ): Promise<Result<ProjectSettingsPage, UpdateProjectSettingsError>> {
    const project = this.requireProject(projectId);
    if (!project.success) return project;

    const resolvedTargets = await resolveAllProjectSettingsTargets(
      this.dependencies.db,
      this.dependencies.workspaceIdentity,
      project.data
    );
    const target = await resolveProjectSettingsTarget(
      this.dependencies.workspaceIdentity,
      project.data,
      request,
      resolvedTargets
    );
    if (!target) {
      return err({
        type: 'write-config-failed',
        message: 'Could not resolve the selected working copy.',
      });
    }
    const config = await this.resolveHostProjectConfig(project.data);
    if (!config.success) return config;
    const result = await writeSharedProjectSettingsToConfig(
      target,
      request.fields,
      config.data.personalConfig
    );
    if (!result.success) return result;
    if (!target.sourceWorkspaceId) return err({ type: 'error' });
    const refreshed = await project.data.workspaceRegistry.refreshProjectConfig({
      workspaceId: target.sourceWorkspaceId,
    });
    if (!refreshed.success) {
      log.warn('Failed to refresh shared project config', refreshed.error);
      return err({
        type: 'write-config-failed',
        message:
          `Wrote .emdash.json, but failed to refresh shared project settings. ` +
          `Personal settings were not cleared.`,
      });
    }
    const cleared = await this.clearPersonalShareableFields(project.data, result.data);
    if (!cleared.success) {
      log.warn('Failed to clear shareable project settings', cleared.error);
      return err({
        type: 'write-config-failed',
        message: 'Wrote .emdash.json, but failed to clear shared project settings.',
      });
    }

    const page = await this.getProjectSettingsPageForProject(project.data);
    if (!page.success) return page;
    this.emitSettingsChanged(projectId, await project.data.settings.get());
    return page;
  }

  async migrateProjectConfig(
    projectId: string,
    request: MigrateProjectConfigRequest
  ): Promise<Result<MigrateProjectConfigResult, UpdateProjectSettingsError>> {
    const project = this.requireProject(projectId);
    if (!project.success) return project;

    const config = await this.resolveHostProjectConfig(project.data);
    if (!config.success) return config;
    if (hasConfiguredShareableProjectSettings(config.data.personalConfig)) {
      return err({
        type: 'write-config-failed',
        message: 'Shareable project settings are already configured.',
      });
    }

    const result = await migrateProjectConfigFromProvider(project.data, request, {
      patchPersonalConfig: (patch) =>
        project.data.workspaceRegistry
          .patchPersonalProjectConfig({
            workspaceId: config.data.repositoryId,
            patch,
          })
          .then((outcome) => (outcome.success ? ok(undefined) : err({ type: 'error' }))),
      clearPersonalFields: (fields) => this.clearPersonalShareableFields(project.data, fields),
    });
    if (!result.success) return result;

    const page = await this.getProjectSettingsPageForProject(project.data);
    if (!page.success) return page;
    this.emitSettingsChanged(projectId, await project.data.settings.get());
    return ok({ page: page.data, migration: result.data });
  }

  private requireProject(projectId: string): Result<ProjectProvider, UpdateProjectSettingsError> {
    const project = this.dependencies.projects.getProject(projectId);
    return project ? ok(project) : err({ type: 'project-not-found' });
  }

  private async getProjectSettingsPageForProject(
    project: ProjectProvider
  ): Promise<Result<ProjectSettingsPage, UpdateProjectSettingsError>> {
    const config = await this.resolveHostProjectConfig(project);
    if (!config.success) return config;
    const storedGitSettings = await project.settings.getStoredGitSettings();
    const storedPlacementSettings = await project.settings.getStoredPlacementSettings();
    const worktreeRootContext = await project.settings.getWorktreeRootContext();
    const resolvedTargets = await resolveAllProjectSettingsTargets(
      this.dependencies.db,
      this.dependencies.workspaceIdentity,
      project
    );
    const writeTargets = getProjectSettingsWriteTargets(resolvedTargets);
    const configMigrations = hasConfiguredShareableProjectSettings(config.data.personalConfig)
      ? []
      : await inspectProjectConfigMigrations(project);
    return ok({
      domains: projectSettingsDomains(
        config.data,
        storedGitSettings,
        storedPlacementSettings,
        worktreeRootContext,
        writeTargets
      ),
      configMigrations,
      shouldPromptConfigMigration: configMigrations.length > 0,
    });
  }

  private async resolveHostProjectConfig(
    project: ProjectProvider
  ): Promise<Result<ProjectConfigState, UpdateProjectSettingsError>> {
    const workspaceId = project.project.repositoryWorkspaceId;
    if (!workspaceId) return err({ type: 'error' });
    const result = await getProjectConfigEnsuringRegistration(
      project.workspaceRegistry,
      workspaceId,
      project.repoPath
    );
    if (!result.success) {
      log.warn('Failed to resolve host project config', {
        projectId: project.projectId,
        error: result.error,
      });
      return err({ type: 'error' });
    }
    return result;
  }

  private async clearPersonalShareableFields(
    project: ProjectProvider,
    clearShareableFields: WriteProjectConfigRequest['fields']
  ): Promise<Result<void, UpdateProjectSettingsError>> {
    const patch = tombstonePatchFor(clearShareableFields);
    if (Object.keys(patch).length === 0) return ok(undefined);
    const workspaceId = project.project.repositoryWorkspaceId;
    if (!workspaceId) return err({ type: 'error' });
    const result = await project.workspaceRegistry.patchPersonalProjectConfig({
      workspaceId,
      patch,
    });
    return result.success ? ok(undefined) : err({ type: 'error' });
  }

  private emitSettingsChanged(projectId: string, settings: ProjectSettings): void {
    this._hooks.callHookBackground('project-settings:changed', { projectId, settings });
  }
}

function projectSettingsDomains(
  config: ProjectConfigState,
  storedGitSettings: StoredProjectGitSettings,
  storedPlacementSettings: StoredPlacementSettings,
  worktreeRootContext: WorktreeRootContext,
  writeTargets: ProjectSettingsWriteTargetOption[]
): ProjectSettingsDomains {
  const { worktreeRoot, ...storedGitIdentity } = storedGitSettings;
  return {
    ...projectConfigDomainsFromState(config, writeTargets),
    gitIdentity: {
      stored: storedGitIdentity,
    },
    placement: {
      stored: {
        ...(worktreeRoot !== undefined ? { worktreeRoot } : {}),
        ...(storedPlacementSettings.tmux !== undefined
          ? { tmux: storedPlacementSettings.tmux }
          : {}),
      },
      layers: worktreeRootContext,
      resolved: {
        worktreeRoot: resolveWorktreeRoot({
          projectWorktreeRoot: worktreeRoot,
          hostWorktreeRoot: worktreeRootContext.hostWorktreeRoot,
          builtInWorktreeRoot: worktreeRootContext.builtInWorktreeRoot,
          homeDirectory: worktreeRootContext.homeDirectory,
        }),
      },
    },
  };
}
