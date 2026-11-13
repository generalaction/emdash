export type WaitlistPersistedState = {
  /** Release (see `releaseKey`) in which the user last dismissed the card. */
  dismissedRelease?: string;
  /** Set once the user has joined; the card never returns after that. */
  joinedEmail?: string;
};

export type WaitlistCardMode = 'hidden' | 'invite' | 'joined';

/**
 * Canary builds ship several times a week, so dismissal is keyed by the stable
 * release a build belongs to (`1.2.10-canary.102` → `1.2.10`).
 */
export function releaseKey(version: string): string {
  return version.trim().split(/[-+]/, 1)[0] ?? '';
}

export function getWaitlistCardMode(args: {
  currentVersion: string;
  persisted: WaitlistPersistedState;
  /** True for the rest of the session after joining, to show the confirmation. */
  showJoinedConfirmation: boolean;
}): WaitlistCardMode {
  if (args.persisted.joinedEmail) return args.showJoinedConfirmation ? 'joined' : 'hidden';
  const release = releaseKey(args.currentVersion);
  if (!release) return 'hidden';
  return args.persisted.dismissedRelease === release ? 'hidden' : 'invite';
}
