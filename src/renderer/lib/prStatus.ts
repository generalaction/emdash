import type { PrInfo } from '../types/pr';

export type { PrInfo } from '../types/pr';

export const isActivePr = (pr?: PrInfo | null): pr is PrInfo => {
  if (!pr) return false;
  const state = typeof pr?.state === 'string' ? pr.state.toLowerCase() : '';
  if (state === 'merged' || state === 'closed') return false;
  return true;
};
