export type ProviderUsageWindow = {
  label: string;
  utilization: number;
  resetsAt: string | null;
};

export type ProviderUsageCredits = {
  label: string;
  used: number;
  limit: number;
  currency: string;
};

export type ProviderUsage = {
  providerId: 'claude' | 'codex';
  plan: string | null;
  account: string | null;
  windows: ProviderUsageWindow[];
  credits: ProviderUsageCredits | null;
  fetchedAt: number;
};

export type ProviderUsageResult =
  | { status: 'ok'; usage: ProviderUsage }
  | { status: 'unauthenticated' }
  | { status: 'unsupported' }
  | { status: 'error'; message: string };
