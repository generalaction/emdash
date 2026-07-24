import type { Result } from '@emdash/shared';
import type { ProjectSettings, ProjectSettingsPatch } from '@core/primitives/project-settings/api';
import type { UpdateProjectSettingsError } from '@core/primitives/projects/api';
export type { ProjectSettingsPatch };

export interface ProjectSettingsProvider {
  getDefaultBranch(): Promise<string>;
  getBaseRemote(): Promise<string>;
  getPushRemote(): Promise<string>;
  getDefaultWorktreeDirectory(): Promise<string>;
  getWorktreeDirectory(): Promise<string>;
  get(): Promise<ProjectSettings>;
  update(settings: ProjectSettings): Promise<Result<void, UpdateProjectSettingsError>>;
  patch(patch: ProjectSettingsPatch): Promise<Result<void, UpdateProjectSettingsError>>;
  ensure(): Promise<void>;
}
