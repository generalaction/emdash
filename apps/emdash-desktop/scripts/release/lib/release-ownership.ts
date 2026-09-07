const OWNERSHIP_PREFIX = '<!-- emdash-release-owner ';

export interface ReleaseOwnership {
  runId: string;
  sha: string;
}

function validateOwnership({ runId, sha }: ReleaseOwnership): void {
  if (!/^\d+$/.test(runId)) throw new Error(`Invalid GitHub run id: ${runId}`);
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error(`Invalid Git commit SHA: ${sha}`);
}

export function releaseOwnershipMarker(ownership: ReleaseOwnership): string {
  validateOwnership(ownership);
  return `${OWNERSHIP_PREFIX}run=${ownership.runId} sha=${ownership.sha.toLowerCase()} -->`;
}

export function releaseHasOwnership(
  body: string | null | undefined,
  ownership: ReleaseOwnership
): boolean {
  return body?.includes(releaseOwnershipMarker(ownership)) ?? false;
}
