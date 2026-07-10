import { gitContract, type GitContract } from '@emdash/core/git';
import type { ContractImpl } from '@emdash/wire';
import type { GitRuntime } from '../git-runtime';
import { createCheckoutEndpoints } from './checkout-endpoints';
import { createCheckoutLiveModelProvider } from './checkout-live-model';
import { createFileDiffLiveModelProvider } from './file-diff-live-model';
import { toJobError } from './lease';
import { createRepositoryEndpoints } from './repository-endpoints';
import { createRepositoryLiveModelProvider } from './repository-live-model';

export type GitContractAdapter = Readonly<{
  implementation: ContractImpl<GitContract>;
  dispose(): Promise<void>;
}>;

export function createGitContractAdapter(
  runtime: GitRuntime,
  contract: GitContract = gitContract
): GitContractAdapter {
  const repositoryModel = createRepositoryLiveModelProvider(runtime, contract.repository.model);
  const checkoutModel = createCheckoutLiveModelProvider(runtime, contract.checkout.model);
  const fileDiffModel = createFileDiffLiveModelProvider(runtime, contract.checkout.fileDiff);

  return {
    implementation: {
      inspectPath: (input) => runtime.inspectPath(input.path),
      ensureRepository: (input) => runtime.ensureRepository(input.path, input.options),
      cloneRepository: {
        run: (input, context) =>
          runtime.cloneRepository(input.repositoryUrl, input.targetPath, {
            signal: context.signal,
            onProgress: context.progress,
          }),
        toError: toJobError,
      },
      repository: createRepositoryEndpoints(runtime, repositoryModel),
      checkout: createCheckoutEndpoints(runtime, checkoutModel, fileDiffModel),
    },
    async dispose(): Promise<void> {
      await Promise.all([
        repositoryModel.dispose(),
        checkoutModel.dispose(),
        fileDiffModel.dispose(),
      ]);
    },
  };
}
