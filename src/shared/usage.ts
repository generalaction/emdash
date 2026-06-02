export type UsageProvider = 'claude' | 'codex' | 'pi';

export type TokenBuckets = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type ModelUsage = TokenBuckets & {
  model: string;
  provider: UsageProvider;
  family: string | null; // null = unpriced
  priced: boolean;
  tokens: number; // input + output (excludes cache), for headline figures
  cost: number;
};

export type ProjectUsage = {
  path: string;
  name: string;
  tokens: number;
  cost: number;
  sessions: number;
};

export type DailyPoint = { date: string; cost: number; tokens: number }; // local YYYY-MM-DD

export type RecentSession = {
  id: string;
  provider: UsageProvider;
  cwd: string | null;
  name: string;
  model: string | null;
  lastTs: string;
  messages: number;
  cost: number;
};

export type UsageWindows = { today: number; week: number; month: number; allTime: number };

export type UsageTotals = {
  sessions: number;
  messages: number;
  tokens: number; // input + output (excludes cache)
  tokensWithCache: number;
  cost: number;
};

export type UsageSnapshot = {
  generatedAt: string;
  pricingUpdated: string;
  totals: UsageTotals;
  windows: UsageWindows;
  byModel: ModelUsage[];
  byProject: ProjectUsage[];
  daily: DailyPoint[];
  byHour: number[]; // length 24
  recentSessions: RecentSession[];
  unpricedModels: string[];
};

export const EMPTY_USAGE_SNAPSHOT: UsageSnapshot = {
  generatedAt: '',
  pricingUpdated: '',
  totals: { sessions: 0, messages: 0, tokens: 0, tokensWithCache: 0, cost: 0 },
  windows: { today: 0, week: 0, month: 0, allTime: 0 },
  byModel: [],
  byProject: [],
  daily: [],
  byHour: Array.from({ length: 24 }, () => 0),
  recentSessions: [],
  unpricedModels: [],
};
