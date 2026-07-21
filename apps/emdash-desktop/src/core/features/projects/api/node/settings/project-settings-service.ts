import { err, ok, type Result } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import type { ProjectSessionManager } from '@core/features/projects/api/node/project-manager';
import type { ProjectProvider } from '@core/features/projects/api/node/project-provider';
import { projectEvents } from '@core/features/projects/node';
import type { WorkspaceIdentityService } from '@core/features/workspaces/api/node/workspace-identity-service';
import { HookCore, type Hookable } from '@core/primitives/hooks/api/hookable';
import {
  type MigrateProjectConfigRequest,
  type MigrateProjectConfigResult,
  type ProjectSettingsPatch,
  type ProjectSettings,
  type ProjectSettingsPage,
  type WriteProjectConfigRequest,
} from '@core/primitives/project-settings/api';
import { hasConfiguredShareableProjectSettings } from '@core/primitives/project-settings/api';
import type { UpdateProjectSettingsError } from '@core/primitives/projects/api';
import type { AppDb } from '@core/services/app-db/node/db';
import {
  inspectProjectConfigMigrations,
  migrateProjectConfigFromProvider,
} from '../../../node/settings/sharing/config-migration';
import { computeProjectSettingsOverrideState } from '../../../node/settings/sharing/project-settings-override-state';
import {
  getProjectSettingsWriteTargets,
  resolveAllProjectSettingsTargets,
} from '../../../node/settings/sharing/project-settings-target-resolver';
import { shareProjectSettingsToConfig as writeSharedProjectSettingsToConfig } from '../../../node/settings/sharing/share-project-settings-to-config';

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

  async getProjectSettingsPage(
    projectId: string
  ): Promise<Result<ProjectSettingsPage, UpdateProjectSettingsError>> {
    const project = this.requireProject(projectId);
    if (!project.success) return project;
    return ok(await this.getProjectSettingsPageForProject(project.data));
  }

  async updateProjectSettings(
    projectId: string,
    settings: ProjectSettings
  ): Promise<Result<ProjectSettings, UpdateProjectSettingsError>> {
    const project = this.requireProject(projectId);
    if (!project.success) return project;

    const result = await project.data.settings.update(settings);
    if (!result.success) return result;

    const updatedSettings = await project.data.settings.get();
    this.emitSettingsChanged(projectId, updatedSettings);
    return ok(updatedSettings);
  }

  async patchProjectSettings(
    projectId: string,
    patch: ProjectSettingsPatch
  ): Promise<Result<ProjectSettings, UpdateProjectSettingsError>> {
    const project = this.requireProject(projectId);
    if (!project.success) return project;

    const result = await project.data.settings.patch(patch);
    if (!result.success) return result;

    const updatedSettings = await project.data.settings.get();
    this.emitSettingsChanged(projectId, updatedSettings);
    return ok(updatedSettings);
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
    const result = await writeSharedProjectSettingsToConfig(
      this.dependencies.workspaceIdentity,
      project.data,
      request,
      resolvedTargets
    );
    if (!result.success) return result;

    const page = await this.getProjectSettingsPageForProject(project.data);
    this.emitSettingsChanged(projectId, page.settings);
    return ok(page);
  }

  async migrateProjectConfig(
    projectId: string,
    request: MigrateProjectConfigRequest
  ): Promise<Result<MigrateProjectConfigResult, UpdateProjectSettingsError>> {
    const project = this.requireProject(projectId);
    if (!project.success) return project;

    const settings = await project.data.settings.get();
    if (hasConfiguredShareableProjectSettings(settings)) {
      return err({
        type: 'write-config-failed',
        message: 'Shareable project settings are already configured.',
      });
    }

    const result = await migrateProjectConfigFromProvider(project.data, request);
    if (!result.success) return result;

    const page = await this.getProjectSettingsPageForProject(project.data);
    this.emitSettingsChanged(projectId, page.settings);
    return ok({ page, migration: result.data });
  }

  private requireProject(projectId: string): Result<ProjectProvider, UpdateProjectSettingsError> {
    const project = this.dependencies.projects.getProject(projectId);
    return project ? ok(project) : err({ type: 'project-not-found' });
  }

  private async getProjectSettingsPageForProject(
    project: ProjectProvider
  ): Promise<ProjectSettingsPage> {
    const settings = await project.settings.get();
    const defaults = {
      worktreeDirectory: await project.settings.getDefaultWorktreeDirectory(),
    };
    const resolvedTargets = await resolveAllProjectSettingsTargets(
      this.dependencies.db,
      this.dependencies.workspaceIdentity,
      project
    );
    const writeTargets = getProjectSettingsWriteTargets(resolvedTargets);
    const overrideState = await computeProjectSettingsOverrideState(resolvedTargets);
    const configMigrations = hasConfiguredShareableProjectSettings(settings)
      ? []
      : await inspectProjectConfigMigrations(project);
    return {
      settings,
      defaults,
      writeTargets,
      overrideState,
      configMigrations,
      shouldPromptConfigMigration: configMigrations.length > 0,
    };
  }

  private emitSettingsChanged(projectId: string, settings: ProjectSettings): void {
    this._hooks.callHookBackground('project-settings:changed', { projectId, settings });
  }
}
