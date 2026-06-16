import type {
  ProjectSettings,
  ProjectSettingsPatch,
} from '@shared/core/project-settings/project-settings';
import type { Result } from '@shared/lib/result';
import type { UpdateProjectSettingsError } from '@shared/projects';
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
