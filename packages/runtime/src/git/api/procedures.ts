import { gitContract, type GitContract } from '@emdash/core/git';
import type { ContractImpl } from '@emdash/wire';
import type { GitRuntime } from '../git-runtime';
import { createCheckoutProcedures } from './checkout-procedures';
import { createRepositoryProcedures } from './repository-procedures';

export type GitProcedures = ContractImpl<GitContract>;

export function createGitProcedures(
  runtime: GitRuntime,
  contract: GitContract = gitContract
): GitProcedures {
  return {
    inspectPath: (input) => runtime.provisioning.inspectPath(input.path),
    ensureRepository: (input) => runtime.provisioning.ensureRepository(input.path, input.options),
    cloneRepository: {
      run: (input, context) =>
        runtime.provisioning.cloneRepository(input.repositoryUrl, input.targetPath, {
          signal: context.signal,
          onProgress: context.progress,
        }),
    },
    repository: {
      ...createRepositoryProcedures(runtime.repository),
      model: runtime.repository.modelHost(contract.repository.model),
    },
    checkout: {
      ...createCheckoutProcedures(runtime.checkout),
      model: runtime.checkout.modelHost(contract.checkout.model),
      fileDiff: runtime.checkout.fileDiffHost(contract.checkout.fileDiff),
    },
  };
}
