type ChannelOpenErrorLike = {
  message?: unknown;
  reason?: unknown;
};

export function isSshChannelOpenFailure(error: unknown): boolean {
  const candidate = error as ChannelOpenErrorLike | undefined;
  const message =
    typeof candidate?.message === 'string'
      ? candidate.message
      : error instanceof Error
        ? error.message
        : String(error);
  const reason = typeof candidate?.reason === 'number' ? candidate.reason : undefined;
  const lower = message.toLowerCase();

  if (
    reason !== undefined ||
    lower.includes('channel open failure') ||
    lower.includes('no more sessions') ||
    lower.includes('administratively prohibited')
  ) {
    return true;
  }

  return false;
}
