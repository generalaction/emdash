import { addWorktreeImpl } from '@services/workspace-lifecycle/api/steps/impl/add-worktree';
import { copyPreservedFilesImpl } from '@services/workspace-lifecycle/api/steps/impl/copy-preserved-files';
import { createDirectoryImpl } from '@services/workspace-lifecycle/api/steps/impl/create-directory';
import { createLocalBranchImpl } from '@services/workspace-lifecycle/api/steps/impl/create-local-branch';
import { deleteBranchImpl } from '@services/workspace-lifecycle/api/steps/impl/delete-branch';
import { ensureRemoteImpl } from '@services/workspace-lifecycle/api/steps/impl/ensure-remote';
import { gitCloneImpl } from '@services/workspace-lifecycle/api/steps/impl/git-clone';
import { gitFetchImpl } from '@services/workspace-lifecycle/api/steps/impl/git-fetch';
import { pushBranchImpl } from '@services/workspace-lifecycle/api/steps/impl/push-branch';
import { removeDirectoryImpl } from '@services/workspace-lifecycle/api/steps/impl/remove-directory';
import { removeRemoteImpl } from '@services/workspace-lifecycle/api/steps/impl/remove-remote';
import { removeWorktreeImpl } from '@services/workspace-lifecycle/api/steps/impl/remove-worktree';
import { runScriptImpl } from '@services/workspace-lifecycle/api/steps/impl/run-script';
import { setBranchBaseImpl } from '@services/workspace-lifecycle/api/steps/impl/set-branch-base';
import { setBranchTrackingImpl } from '@services/workspace-lifecycle/api/steps/impl/set-branch-tracking';
import { writeSetupStampImpl } from '@services/workspace-lifecycle/api/steps/impl/write-setup-stamp';
import type { BootstrapStep, BootstrapStepKind } from './catalog';
import type { StepImplementation } from './implement';

export type BootstrapStepRegistry = {
  [Kind in BootstrapStepKind]: StepImplementation;
};

export const bootstrapStepImplementations = [
  gitFetchImpl,
  ensureRemoteImpl,
  createLocalBranchImpl,
  setBranchTrackingImpl,
  setBranchBaseImpl,
  addWorktreeImpl,
  createDirectoryImpl,
  copyPreservedFilesImpl,
  pushBranchImpl,
  removeWorktreeImpl,
  removeDirectoryImpl,
  deleteBranchImpl,
  removeRemoteImpl,
  gitCloneImpl,
  runScriptImpl,
  writeSetupStampImpl,
] as const;

export const bootstrapStepRegistry = Object.fromEntries(
  bootstrapStepImplementations.map((implementation) => [
    implementation.descriptor.kind,
    implementation,
  ])
) as unknown as BootstrapStepRegistry;

export function stepImplementationFor<Step extends BootstrapStep>(
  registry: BootstrapStepRegistry,
  step: Step
): StepImplementation {
  return registry[step.kind];
}
