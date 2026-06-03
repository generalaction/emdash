import type { UsageProvider } from '@shared/usage';

/** One parsed event. `isMessage` records count toward "messages"; token fields sum into usage. */
export type UsageRecord = {
  id: string; // dedup key: Claude message.id / user uuid; Codex synthetic per-line
  isMessage: boolean;
  provider: UsageProvider; // the agent that produced the event (claude/codex/pi)
  vendor: string; // the model's pricing vendor — models.dev provider id (anthropic/openai/google/…)
  ts: string; // ISO; bucketed to LOCAL day/hour at aggregate time
  model: string | null;
  cwd: string | null;
  sessionId: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type ScannedFile = {
  path: string;
  mtimeMs: number;
  size: number;
  provider: UsageProvider;
};
