import type { Result } from '@emdash/shared';
import type {
  PlacementContext,
  Resolved,
  StoredProjectGitSettings,
  StoredIntegrationAccounts,
} from '@core/primitives/project-settings/api';
import type { UpdateProjectSettingsError } from '@core/primitives/projects/api';

export type StoredPlacementSettings = {
  tmux?: boolean;
};

export interface ProjectSettingsProvider {
  /**
   * Stored git settings in the inference-first model (spec:
   * github-git-settings §2): only explicit user choices, absence = infer.
   * Effective values come from the blessed resolver over these plus repo
   * facts — never from local fallbacks.
   */
  getStoredGitSettings(): Promise<StoredProjectGitSettings>;
  getStoredIntegrationAccounts(): Promise<StoredIntegrationAccounts>;
  /**
   * The host/app placement layers below per-project overrides: worktree-root
   * defaults plus the host home, and host/app tmux defaults. Shipped to the
   * renderer unchanged so preview and execution use identical resolver inputs.
   */
  getPlacementContext(): Promise<PlacementContext>;
  /** Explicit DB-owned placement settings consumed by execution flows. */
  getStoredPlacementSettings(): Promise<StoredPlacementSettings>;
  /** Effective tmux value from the shared project > host > app resolver. */
  resolveTmux(): Promise<Resolved<boolean>>;
  setWorktreeRoot(worktreeRoot: string | null): Promise<Result<void, UpdateProjectSettingsError>>;
  ensure(): Promise<void>;
}
