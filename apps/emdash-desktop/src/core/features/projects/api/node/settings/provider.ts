import type { Result } from '@emdash/shared';
import type {
  ProjectSettings,
  ProjectSettingsPatch,
  StoredProjectGitSettings,
  WorktreeRootContext,
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
  /**
   * The worktree-root layers below the per-project override (spec §6):
   * per-host default, built-in root, and the host home directory. The
   * resolver input for `worktreeRoot`; shipped to the renderer unchanged so
   * provenance ("host default" vs "built-in default") stays honest.
   */
  getWorktreeRootContext(): Promise<WorktreeRootContext>;
  get(): Promise<ProjectSettings>;
  update(settings: ProjectSettings): Promise<Result<void, UpdateProjectSettingsError>>;
  patch(patch: ProjectSettingsPatch): Promise<Result<void, UpdateProjectSettingsError>>;
  ensure(): Promise<void>;
}
