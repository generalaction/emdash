export function isActivationLostError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const type = (error as { type?: unknown }).type;
  return type === 'stale_activation' || type === 'activation_missing';
}
