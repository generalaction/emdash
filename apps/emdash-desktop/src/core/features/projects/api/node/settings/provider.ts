import type { Result } from '@emdash/shared';
import type {
  ProjectSettings,
  ProjectSettingsPatch,
  StoredProjectGitSettings,
} from '@core/primitives/project-settings/api';
import type { UpdateProjectSettingsError } from '@core/primitives/projects/api';
export type { ProjectSettingsPatch };

export interface ProjectSettingsProvider {
  getDefaultBranch(): Promise<string>;
  getBaseRemote(): Promise<string>;
  getPushRemote(): Promise<string>;
  getDefaultWorktreeDirectory(): Promise<string>;
  getWorktreeDirectory(): Promise<string>;
  /** Stored explicit git choices (absence = infer) — the resolver input. */
  getStoredGitSettings(): Promise<StoredProjectGitSettings>;
  get(): Promise<ProjectSettings>;
  update(settings: ProjectSettings): Promise<Result<void, UpdateProjectSettingsError>>;
  patch(patch: ProjectSettingsPatch): Promise<Result<void, UpdateProjectSettingsError>>;
  ensure(): Promise<void>;
}
