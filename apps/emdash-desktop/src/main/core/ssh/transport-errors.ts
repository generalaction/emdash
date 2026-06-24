const RECOVERABLE_SSH_TRANSPORT_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTCONN',
  'EPIPE',
  'ETIMEDOUT',
]);

export function isRecoverableSshTransportError(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : null;
  if (typeof code === 'string' && RECOVERABLE_SSH_TRANSPORT_ERROR_CODES.has(code)) return true;

  const message = error instanceof Error ? error.message : String(error);
  return /SSH connection is not available|read ETIMEDOUT|timed out|connection (?:reset|refused|closed)|not connected|socket hang up/i.test(
    message
  );
}
