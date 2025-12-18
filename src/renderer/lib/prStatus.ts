export type PrInfo = {
  number?: number;
  title?: string;
  url?: string;
  state?: string | null;
  isDraft?: boolean;
};

export const isActivePr = (pr?: PrInfo | null): pr is PrInfo => {
  if (!pr) return false;
  const state = typeof pr?.state === 'string' ? pr.state.toLowerCase() : '';
  if (state === 'merged' || state === 'closed') return false;
  return true;
};
