import type { ProjectSettings, ShareableProjectSettingsWriteField } from '@shared/project-settings';
import type { UpdateProjectSettingsError } from '@shared/projects';
import type { Result } from '@shared/result';

export type ProjectSettingsPatch = {
  clearShareableFields?: ShareableProjectSettingsWriteField[];
};

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
