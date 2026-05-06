import type { UpdateProjectSettingsError } from '@shared/projects';
import type { Result } from '@shared/result';
import type { ProjectSettings } from '@main/core/projects/settings/schema';
import { rpc } from '@renderer/lib/ipc';
import { Resource } from '@renderer/lib/stores/resource';

export class ProjectSettingsStore {
  readonly settingsData: Resource<ProjectSettings>;

  constructor(private readonly projectId: string) {
    this.settingsData = new Resource(
      () => rpc.projects.getProjectSettings(projectId),
      [{ kind: 'demand' }]
    );
  }

  get settings(): ProjectSettings | null {
    return this.settingsData.data;
  }

  async save(settings: ProjectSettings): Promise<Result<void, UpdateProjectSettingsError>> {
    const result = await rpc.projects.updateProjectSettings(this.projectId, settings);
    if (result.success) {
      this.settingsData.invalidate();
    }
    return result;
  }

  dispose(): void {
    this.settingsData.dispose();
  }
}
