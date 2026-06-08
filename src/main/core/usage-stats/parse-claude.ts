import type { UsageRecord } from './types';

type ClaudeUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

type ClaudeLine = {
  type?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  uuid?: string;
  requestId?: string;
  message?: { id?: string; model?: string; usage?: ClaudeUsage };
};

export function parseClaudeTranscript(text: string): UsageRecord[] {
  const out: UsageRecord[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let o: ClaudeLine;
    try {
      o = JSON.parse(line) as ClaudeLine;
    } catch {
      continue;
    }

    if (o.type === 'assistant' && o.message?.usage) {
      const id = o.message.id ?? o.requestId;
      if (!id) continue;
      const u = o.message.usage;
      out.push({
        id,
        isMessage: true,
        provider: 'claude',
        vendor: 'anthropic',
        ts: o.timestamp ?? '',
        model: o.message.model ?? null,
        cwd: o.cwd ?? null,
        sessionId: o.sessionId ?? '',
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
      });
    } else if (o.type === 'user' && o.uuid) {
      out.push({
        id: o.uuid,
        isMessage: true,
        provider: 'claude',
        vendor: 'anthropic',
        ts: o.timestamp ?? '',
        model: null,
        cwd: o.cwd ?? null,
        sessionId: o.sessionId ?? '',
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      });
    }
  }
  return out;
}
