export const SESSION_BACKENDS = ['none', 'tmux', 'zellij'] as const;

export type SessionBackend = (typeof SESSION_BACKENDS)[number];
export type PersistentSessionBackend = Exclude<SessionBackend, 'none'>;

export function parseSessionBackend(value: unknown): SessionBackend | null {
  return value === 'none' || value === 'tmux' || value === 'zellij' ? value : null;
}

export function resolveConfiguredSessionBackend(
  config: { sessionBackend?: unknown; tmux?: unknown } | null | undefined
): SessionBackend | null {
  if (!config || typeof config !== 'object') {
    return null;
  }

  const explicit = parseSessionBackend(config.sessionBackend);
  if (explicit) {
    return explicit;
  }

  if (config.tmux === true) {
    return 'tmux';
  }

  return null;
}

export function normalizeSessionBackend(
  config: { sessionBackend?: unknown; tmux?: unknown } | null | undefined
): SessionBackend {
  return resolveConfiguredSessionBackend(config) ?? 'none';
}

export function isPersistentSessionBackend(
  value: SessionBackend | PersistentSessionBackend | null | undefined
): value is PersistentSessionBackend {
  return value === 'tmux' || value === 'zellij';
}

export function getPersistentSessionName(ptyId: string): string {
  const sanitized = ptyId.replace(/[^a-zA-Z0-9._-]/g, '-');
  return `emdash-${sanitized}`;
}
