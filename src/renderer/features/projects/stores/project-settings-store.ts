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

  async save(settings: ProjectSettings): Promise<void> {
    await rpc.projects.updateProjectSettings(this.projectId, settings);
    this.settingsData.invalidate();
  }

  dispose(): void {
    this.settingsData.dispose();
  }
}
