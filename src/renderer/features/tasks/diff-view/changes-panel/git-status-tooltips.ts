const INITIAL_COMMIT_TOOLTIP = 'Create an initial commit first.';

export function getBranchTooltipText(branchName: string | null | undefined): string {
  return branchName ? branchName : INITIAL_COMMIT_TOOLTIP;
}

export function getPublishTooltipText({
  isPublishing,
  branchName,
  shouldOfferAddRemote,
}: {
  isPublishing: boolean;
  branchName: string | null | undefined;
  shouldOfferAddRemote: boolean;
}): string {
  if (isPublishing) return 'Publishing...';
  if (!branchName) return INITIAL_COMMIT_TOOLTIP;
  if (shouldOfferAddRemote) return 'Create or link a remote, then publish this branch';
  return 'Publish branch';
}
