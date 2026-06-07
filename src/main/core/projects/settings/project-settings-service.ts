import { events } from '@main/lib/events';
import { HookCore, type Hookable } from '@main/lib/hookable';
import type { IInitializable } from '@main/lib/lifecycle';
import { log } from '@main/lib/logger';
import {
  type MigrateProjectConfigRequest,
  type MigrateProjectConfigResult,
  type ProjectSettings,
  type ProjectSettingsPage,
  type WriteProjectConfigRequest,
} from '@shared/core/project-settings/project-settings';
import { hasConfiguredShareableProjectSettings } from '@shared/core/project-settings/project-settings-fields';
import { projectSettingsChangedChannel } from '@shared/core/projects/projectEvents';
import { err, ok, type Result } from '@shared/lib/result';
import type { UpdateProjectSettingsError } from '@shared/projects';
import { projectManager } from '../project-manager';
import type { ProjectProvider } from '../project-provider';
import {
  inspectProjectConfigMigrations,
  migrateProjectConfigFromProvider,
} from './sharing/config-migration';
import { computeProjectSettingsOverrideState } from './sharing/project-settings-override-state';
import {
  getProjectSettingsWriteTargets,
  resolveAllProjectSettingsTargets,
} from './sharing/project-settings-target-resolver';
import { shareProjectSettingsToConfig as writeSharedProjectSettingsToConfig } from './sharing/share-project-settings-to-config';

export type ProjectSettingsHooks = {
  'project-settings:changed': (event: {
    projectId: string;
    settings: ProjectSettings;
  }) => void | Promise<void>;
};

export class ProjectSettingsService implements Hookable<ProjectSettingsHooks>, IInitializable {
  private readonly _hooks = new HookCore<ProjectSettingsHooks>((name, e) =>
    log.error(`ProjectSettingsService: ${String(name)} hook error`, e)
  );
  private _disposeRendererBridge: (() => void) | null = null;

  on<K extends keyof ProjectSettingsHooks>(name: K, handler: ProjectSettingsHooks[K]) {
    return this._hooks.on(name, handler);
  }

  initialize(): void {
    this._disposeRendererBridge?.();
    this._disposeRendererBridge = this.on('project-settings:changed', ({ projectId }) => {
      events.emit(projectSettingsChangedChannel, { projectId });
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

  async shareProjectSettingsToConfig(
    projectId: string,
    request: WriteProjectConfigRequest
  ): Promise<Result<ProjectSettingsPage, UpdateProjectSettingsError>> {
    const project = this.requireProject(projectId);
    if (!project.success) return project;

    const resolvedTargets = await resolveAllProjectSettingsTargets(project.data);
    const result = await writeSharedProjectSettingsToConfig(project.data, request, resolvedTargets);
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
    const project = projectManager.getProject(projectId);
    return project ? ok(project) : err({ type: 'project-not-found' });
  }

  private async getProjectSettingsPageForProject(
    project: ProjectProvider
  ): Promise<ProjectSettingsPage> {
    const settings = await project.settings.get();
    const defaults = {
      worktreeDirectory: await project.settings.getDefaultWorktreeDirectory(),
    };
    const resolvedTargets = await resolveAllProjectSettingsTargets(project);
    const writeTargets = getProjectSettingsWriteTargets(resolvedTargets);
    const overrideState = await computeProjectSettingsOverrideState(resolvedTargets);
    const configMigrations = hasConfiguredShareableProjectSettings(settings)
      ? []
      : await inspectProjectConfigMigrations(project.fs);
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

export const projectSettingsService = new ProjectSettingsService();
