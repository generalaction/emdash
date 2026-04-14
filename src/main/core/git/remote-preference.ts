export const DEFAULT_REMOTE_NAME = 'origin';

export function selectPreferredRemote(
  configuredRemote: string | undefined,
  remotes: ReadonlyArray<{ name: string }>
): string {
  const preferred = configuredRemote?.trim();
  if (!preferred) {
    return DEFAULT_REMOTE_NAME;
  }

  if (preferred === DEFAULT_REMOTE_NAME) {
    return DEFAULT_REMOTE_NAME;
  }

  if (remotes.some((remote) => remote.name === preferred)) {
    return preferred;
  }

  return DEFAULT_REMOTE_NAME;
}
