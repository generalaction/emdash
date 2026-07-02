/** App-facing connection state for an integration account. */
export type ConnectionStatus =
  | {
      connected: true;
      /** Resolved account identity, e.g. user or workspace name shown in settings. */
      displayName?: string;
      /** Secondary detail, e.g. organization or host when it differs from displayName. */
      displayDetail?: string;
    }
  | {
      connected: false;
      /** Absent when simply not configured; present when verification failed. */
      error?: string;
    };
