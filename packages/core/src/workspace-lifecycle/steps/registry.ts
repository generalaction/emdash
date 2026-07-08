import type { BootstrapStep, BootstrapStepKind } from './catalog';
import { addWorktreeImpl } from './impl/add-worktree';
import { copyPreservedFilesImpl } from './impl/copy-preserved-files';
import { createLocalBranchImpl } from './impl/create-local-branch';
import { deleteBranchImpl } from './impl/delete-branch';
import { ensureRemoteImpl } from './impl/ensure-remote';
import { gitFetchImpl } from './impl/git-fetch';
import { pushBranchImpl } from './impl/push-branch';
import { removeRemoteImpl } from './impl/remove-remote';
import { removeWorktreeImpl } from './impl/remove-worktree';
import { runScriptImpl } from './impl/run-script';
import { setBranchBaseImpl } from './impl/set-branch-base';
import { setBranchTrackingImpl } from './impl/set-branch-tracking';
import { writeSetupStampImpl } from './impl/write-setup-stamp';
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
  copyPreservedFilesImpl,
  pushBranchImpl,
  removeWorktreeImpl,
  deleteBranchImpl,
  removeRemoteImpl,
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
