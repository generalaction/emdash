import type { PullRequest } from '@agent/plugins/pull-requests/schemas';
import { getPrNumber, isForkPr } from '@root/src/core/services/pull-requests/api';
import { prCheckoutSourceRef } from './pr-source-refs';

/** The updateWorktree verb's git half: instruction-as-input, desktop-compiled. */
export type PrUpdateInstruction = { remote: string; sourceRef: string };

export type PrUpdateInstructionContext = {
  /** The project's base remote (default 'origin'); the remote PR heads fetch from. */
  baseRemote: string;
};

/** Compile the associated PR/MR source ref for the workspace update operation. */
export function compilePrUpdateInstruction(
  pr: Pick<
    PullRequest,
    'provider' | 'identifier' | 'headRefName' | 'headRepositoryUrl' | 'repositoryUrl'
  >,
  context: PrUpdateInstructionContext
): PrUpdateInstruction | null {
  const prNumber = getPrNumber(pr);
  if (prNumber === null) return null;
  return {
    remote: context.baseRemote,
    sourceRef: prCheckoutSourceRef({
      prNumber,
      provider: pr.provider,
      headBranch: pr.headRefName,
      isFork: isForkPr(pr),
    }),
  };
}
