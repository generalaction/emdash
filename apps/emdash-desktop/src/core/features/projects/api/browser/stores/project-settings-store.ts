import type { HostFileRef } from '@emdash/core/primitives/path/api';
import type { Result } from '@emdash/shared';
import { watchFileContent } from '@core/features/files/api/browser/file-content';
import { Resource } from '@core/primitives/async-resource/browser/resource';
import {
  type MigrateProjectConfigRequest,
  type MigrateProjectConfigResult,
  type ProjectConfigMigration,
  type ProjectSettings,
  type ProjectSettingsOverrideState,
  type ProjectSettingsPage,
  type ProjectSettingsWriteTargetOption,
  type WriteProjectConfigRequest,
} from '@core/primitives/project-settings/api';
import type { UpdateProjectSettingsError } from '@core/primitives/projects/api';
import { getProjectsWireClient } from '../client';

export class ProjectSettingsStore {
  readonly pageData: Resource<ProjectSettingsPage>;
  private _unsubscribeConfigWatch: () => void = () => {};
  private readonly _unsubscribeSettingsChanged: () => void;
  private _disposed = false;

  constructor(
    private readonly projectId: string,
    repositoryConfigFileRef?: HostFileRef
  ) {
    this.pageData = new Resource(async () => {
      const result = await (await getProjectsWireClient()).getProjectSettingsPage({ projectId });
      if (!result.success) {
        throw new Error(
          result.error.type === 'project-not-found'
            ? `Project ${projectId} not found`
            : 'Failed to load project settings'
        );
      }
      return result.data;
    }, [{ kind: 'demand' }]);

    if (repositoryConfigFileRef) {
      void watchFileContent(repositoryConfigFileRef, () => {
        this.pageData.invalidate();
      })
        .then((unsubscribe) => {
          if (this._disposed) unsubscribe();
          else this._unsubscribeConfigWatch = unsubscribe;
        })
        .catch(() => {});
    }

    let unsubscribe: (() => void) | undefined;
    void getProjectsWireClient().then(async (client) => {
      const nextUnsubscribe = await client.events.subscribe(undefined, {
        onEvent: (event) => {
          if (event.projectId === projectId) this.pageData.invalidate();
        },
        onGap: () => this.pageData.invalidate(),
      });
      if (this._disposed) nextUnsubscribe();
      else unsubscribe = nextUnsubscribe;
    });
    this._unsubscribeSettingsChanged = () => unsubscribe?.();
  }

  get settings(): ProjectSettings | null {
    return this.pageData.data?.settings ?? null;
  }

  get defaults(): ProjectSettingsPage['defaults'] | null {
    return this.pageData.data?.defaults ?? null;
  }

  get writeTargets(): ProjectSettingsWriteTargetOption[] | null {
    return this.pageData.data?.writeTargets ?? null;
  }

  get overrideState(): ProjectSettingsOverrideState | null {
    return this.pageData.data?.overrideState ?? null;
  }

  get configMigrations(): ProjectConfigMigration[] | null {
    return this.pageData.data?.configMigrations ?? null;
  }

  get shouldPromptConfigMigration(): boolean {
    return this.pageData.data?.shouldPromptConfigMigration ?? false;
  }

  async load(): Promise<ProjectSettingsPage | null> {
    await this.pageData.load();
    return this.pageData.data;
  }

  async save(
    settings: ProjectSettings
  ): Promise<Result<ProjectSettings, UpdateProjectSettingsError>> {
    const result = await (
      await getProjectsWireClient()
    ).updateProjectSettings({
      projectId: this.projectId,
      settings,
    });
    if (result.success) {
      const current = this.pageData.data;
      if (current) this.pageData.setValue({ ...current, settings: result.data });
      else this.pageData.invalidate();
    }
    return result;
  }

  async writeConfigToRepo(
    request: WriteProjectConfigRequest
  ): Promise<Result<ProjectSettingsPage, UpdateProjectSettingsError>> {
    const result = await (
      await getProjectsWireClient()
    ).shareProjectSettingsToConfig({
      projectId: this.projectId,
      request,
    });
    if (result.success) {
      this.pageData.setValue(result.data);
    }
    return result;
  }

  async migrateProjectConfig(
    request: MigrateProjectConfigRequest
  ): Promise<Result<MigrateProjectConfigResult, UpdateProjectSettingsError>> {
    const result = await (
      await getProjectsWireClient()
    ).migrateProjectConfig({
      projectId: this.projectId,
      request,
    });
    if (result.success) {
      this.pageData.setValue(result.data.page);
    }
    return result;
  }

  dispose(): void {
    this._disposed = true;
    this._unsubscribeConfigWatch();
    this._unsubscribeSettingsChanged();
    this.pageData.dispose();
  }
}
