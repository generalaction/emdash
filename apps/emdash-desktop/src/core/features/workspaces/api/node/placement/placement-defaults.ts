import { deriveWorktreePoolPath as derivePoolPath } from '@emdash/core/runtimes/workspace-registry/api';
import { joinHostPath } from '@core/primitives/desktop-runtime/api';

export type DeriveWorktreePoolPathOptions = {
  worktreesRoot: string;
  repoPath: string;
};

export function defaultRepositoriesRoot(homeDirectory: string): string {
  return joinHostPath(homeDirectory, 'emdash', 'repositories');
}

// The built-in worktree root lives in the portable resolver module
// (`builtInWorktreeRootFor` in @core/primitives/project-settings/api) so
// placement, the settings page, and the create-task preview share one
// definition.

/**
 * Delegates to the one portable pool derivation (workspace-registry API) that
 * worktree payload compilation and the renderer previews also use.
 */
export function deriveWorktreePoolPath({
  worktreesRoot,
  repoPath,
}: DeriveWorktreePoolPathOptions): string {
  return derivePoolPath({ worktreeRoot: worktreesRoot, repoPath });
}
