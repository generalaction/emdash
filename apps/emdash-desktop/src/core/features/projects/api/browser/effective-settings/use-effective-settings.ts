import { getGitRepositoryStore } from '@core/features/source-control/api/browser/stores/source-control-selectors';
import {
  resolveEffectiveSettings,
  type EffectiveSettings,
  type PlacementContext,
  type RepoFacts,
  type StoredProjectGitSettings,
} from '@core/primitives/project-settings/api';
import { getProjectSettingsStore } from '../stores/project-selectors';

/**
 * Renderer-side Git and placement inputs: stored explicit choices and repo
 * facts from the synced repository live model. Surfaces that preview a pending
 * (unsaved) choice re-run `resolveRendererEffectiveSettings` with their own
 * stored settings over the same facts.
 */
export type EffectiveSettingsInputs = {
  storedGitSettings: StoredProjectGitSettings;
  repoFacts: RepoFacts;
  /**
   * Placement layers shipped node-side over the Wire so preview and execution
   * resolve identical worktree-root and tmux inputs.
   */
  placementContext: PlacementContext;
};

export function resolveRendererEffectiveSettings(
  inputs: EffectiveSettingsInputs,
  storedGitSettings: StoredProjectGitSettings = inputs.storedGitSettings
): EffectiveSettings {
  return resolveEffectiveSettings(
    {
      project: storedGitSettings,
      hostWorktreeRoot: inputs.placementContext.hostWorktreeRoot,
      builtInWorktreeRoot: inputs.placementContext.builtInWorktreeRoot,
      homeDirectory: inputs.placementContext.homeDirectory,
      pathProfile: inputs.placementContext.pathProfile,
    },
    inputs.repoFacts
  );
}

/**
 * Resolver inputs from the synced stores. Call only inside `observer`
 * components (or other MobX reactions). Returns null while the settings
 * page or repository model is still loading. A failed repository read
 * degrades to empty repo facts.
 */
export function useEffectiveSettingsInputs(projectId: string): EffectiveSettingsInputs | null {
  const settingsStore = getProjectSettingsStore(projectId);
  const repo = getGitRepositoryStore(projectId);
  const domains = settingsStore?.domains ?? null;
  if (!domains) return null;
  if (repo?.loading) return null;
  return {
    storedGitSettings: {
      ...domains.gitIdentity.stored,
      ...domains.placement.stored,
    },
    repoFacts: repo?.repoFacts ?? { remotes: [], localBranches: [] },
    placementContext: domains.placement.layers,
  };
}
