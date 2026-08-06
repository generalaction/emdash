import { createHash } from 'node:crypto';

export function deriveCleanRoomMutationInspection(
  headCommit: string,
  status: string,
  branch: string,
  baseline?: string
): { mutationBaseline: string; mutated: boolean } {
  const currentFingerprint = createHash('sha256')
    .update(headCommit)
    .update('\0')
    .update(status)
    .update('\0')
    .update(branch)
    .digest('hex');

  return {
    mutationBaseline: baseline ?? currentFingerprint,
    mutated: baseline !== undefined && currentFingerprint !== baseline,
  };
}
