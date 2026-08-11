import type { Result } from '@emdash/shared';
import type {
  ProjectSettings,
  ProjectSettingsPatch,
  StoredProjectGitSettings,
} from '@core/primitives/project-settings/api';
import type { UpdateProjectSettingsError } from '@core/primitives/projects/api';
export type { ProjectSettingsPatch };

export interface ProjectSettingsProvider {
  /**
   * Stored git settings in the inference-first model (spec:
   * github-git-settings §2): only explicit user choices, absence = infer.
   * Effective values come from the blessed resolver over these plus repo
   * facts — never from local fallbacks.
   */
  getStoredGitSettings(): Promise<StoredProjectGitSettings>;
  getDefaultWorktreeDirectory(): Promise<string>;
  getWorktreeDirectory(): Promise<string>;
  /** Stored explicit git choices (absence = infer) — the resolver input. */
  getStoredGitSettings(): Promise<StoredProjectGitSettings>;
  get(): Promise<ProjectSettings>;
  update(settings: ProjectSettings): Promise<Result<void, UpdateProjectSettingsError>>;
  patch(patch: ProjectSettingsPatch): Promise<Result<void, UpdateProjectSettingsError>>;
  ensure(): Promise<void>;
}
