import { fsWatchEventChannel } from '@shared/events/fsEvents';
import {
  PROJECT_CONFIG_FILE,
  type ProjectSettings,
  type ProjectSettingsOverrideState,
  type ProjectSettingsPage,
  type ProjectSettingsWriteTargetOption,
  type WriteProjectConfigRequest,
} from '@shared/project-settings';
import type { UpdateProjectSettingsError } from '@shared/projects';
import type { Result } from '@shared/result';
import { events, rpc } from '@renderer/lib/ipc';
import { Resource } from '@renderer/lib/stores/resource';

export class ProjectSettingsStore {
  readonly pageData: Resource<ProjectSettingsPage>;
  private readonly _unsubscribeConfigWatch: () => void;

  constructor(private readonly projectId: string) {
    this.pageData = new Resource(async () => {
      const result = await rpc.projects.getProjectSettingsPage(projectId);
      if (!result.success) {
        throw new Error(
          result.error.type === 'project-not-found'
            ? `Project ${projectId} not found`
            : 'Failed to load project settings'
        );
      }
      return result.data;
    }, [{ kind: 'demand' }]);

    this._unsubscribeConfigWatch = events.on(fsWatchEventChannel, (data) => {
      if (data.projectId !== projectId) return;
      if (
        data.events.some(
          (event) => event.path === PROJECT_CONFIG_FILE || event.oldPath === PROJECT_CONFIG_FILE
        )
      ) {
        this.pageData.invalidate();
      }
    });
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

  async save(
    settings: ProjectSettings
  ): Promise<Result<ProjectSettings, UpdateProjectSettingsError>> {
    const result = await rpc.projects.updateProjectSettings(this.projectId, settings);
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
    const result = await rpc.projects.shareProjectSettingsToConfig(this.projectId, request);
    if (result.success) {
      this.pageData.setValue(result.data);
    }
    return result;
  }

  dispose(): void {
    this._unsubscribeConfigWatch();
    this.pageData.dispose();
  }
}
