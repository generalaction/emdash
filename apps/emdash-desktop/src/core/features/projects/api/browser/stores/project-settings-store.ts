import type { ProjectConfigState } from '@emdash/core/runtimes/workspace-registry/api';
import { ok, type Result } from '@emdash/shared';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import { observe, pin, remote, type RemoteModel } from '@emdash/wire/state';
import { computed, makeObservable, observable, runInAction } from 'mobx';
import { Resource } from '@core/primitives/async-resource/browser/resource';
import {
  type MigrateProjectConfigRequest,
  type ProjectConfigMigration,
  type WriteProjectConfigRequest,
} from '@core/primitives/project-settings/api';
import type { UpdateProjectSettingsError } from '@core/primitives/projects/api';
import {
  projectConfigDomainsFromState,
  type MigrateProjectConfigResult,
  type ProjectSettingsDomainPatch,
  type ProjectSettingsDomains,
  type ProjectSettingsPage,
} from '../../project-settings-page';
import { projectsWireContract } from '../../wire-contract';
import { getProjectsWireClient } from '../client';

export class ProjectSettingsStore {
  readonly pageData: Resource<ProjectSettingsPage>;
  private readonly _configScope: Scope;
  private _projectConfig: ProjectConfigState | null = null;
  private _projectConfigRemote: RemoteModel<typeof projectsWireContract.projectConfig> | null =
    null;
  private _disposed = false;

  constructor(private readonly projectId: string) {
    this._configScope = createScope({ label: `project-settings-config:${projectId}` });
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

    makeObservable<this, '_projectConfig'>(this, {
      _projectConfig: observable.ref,
      domains: computed,
    });
    this.bindProjectConfig();
  }

  get domains(): ProjectSettingsDomains | null {
    const domains = this.pageData.data?.domains;
    if (!domains || !this._projectConfig) return domains ?? null;
    return {
      ...domains,
      ...projectConfigDomainsFromState(this._projectConfig, domains.lifecycle.writeTargets),
    };
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
    patch: ProjectSettingsDomainPatch
  ): Promise<Result<ProjectSettingsPage, UpdateProjectSettingsError>> {
    const result = await (
      await getProjectsWireClient()
    ).updateProjectSettings({
      projectId: this.projectId,
      patch,
    });
    if (!result.success) return result;
    this.pageData.setValue(result.data);
    return ok(result.data);
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
    void this._configScope.dispose();
    void this._projectConfigRemote?.dispose();
    this.pageData.dispose();
  }

  private bindProjectConfig(): void {
    void getProjectsWireClient()
      .then((client) => {
        if (this._disposed) return;
        const config = remote(projectsWireContract.projectConfig, client.projectConfig, {
          scope: this._configScope,
        });
        const current = config({ projectId: this.projectId }).states.current;
        pin(this._configScope, [current]);
        observe(
          current,
          (snapshot) => {
            if (snapshot.value === undefined) return;
            runInAction(() => {
              this._projectConfig = snapshot.value ?? null;
            });
          },
          { scope: this._configScope, immediate: true }
        );
        this._projectConfigRemote = config;
        if (this._disposed) void config.dispose();
      })
      .catch(() => {});
  }
}
