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

export type IntegrationError =
  | { type: 'auth_failed'; message: string }
  | { type: 'rate_limited'; message: string; resetAt?: string }
  | { type: 'not_found_or_no_access'; message: string }
  | { type: 'sso_required'; message: string; ssoUrl?: string }
  | { type: 'host_unreachable'; message: string }
  | { type: 'unsupported_host'; message: string }
  | { type: 'invalid_input'; message: string }
  | { type: 'generic'; message: string };
