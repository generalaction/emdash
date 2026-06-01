import type { UsageRecord } from './types';

type CodexTotals = {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
};

type CodexLine = {
  type?: string;
  timestamp?: string;
  payload?: {
    type?: string;
    model?: string;
    id?: string;
    cwd?: string;
    info?: { total_token_usage?: CodexTotals };
  };
};

export function parseCodexRollout(text: string, filePath: string): UsageRecord[] {
  const out: UsageRecord[] = [];
  let model: string | null = null;
  let cwd: string | null = null;
  let sessionId = filePath;
  let prevInput = 0;
  let prevCached = 0;
  let prevOutput = 0;
  let idx = 0;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let o: CodexLine;
    try {
      o = JSON.parse(line) as CodexLine;
    } catch {
      continue;
    }
    const p = o.payload;

    if (o.type === 'session_meta' && p) {
      cwd = p.cwd ?? cwd;
      sessionId = p.id ?? sessionId;
    } else if (o.type === 'turn_context' && p?.model) {
      model = p.model;
    } else if (o.type === 'event_msg' && p) {
      if (p.type === 'token_count' && p.info?.total_token_usage) {
        const t = p.info.total_token_usage;
        const inputD = Math.max((t.input_tokens ?? 0) - prevInput, 0);
        const cachedD = Math.max((t.cached_input_tokens ?? 0) - prevCached, 0);
        const outputD = Math.max((t.output_tokens ?? 0) - prevOutput, 0);
        prevInput = t.input_tokens ?? prevInput;
        prevCached = t.cached_input_tokens ?? prevCached;
        prevOutput = t.output_tokens ?? prevOutput;
        if (inputD || cachedD || outputD) {
          out.push({
            id: `codex:${filePath}:${idx++}`,
            isMessage: false,
            provider: 'codex',
            ts: o.timestamp ?? '',
            model,
            cwd,
            sessionId,
            input: Math.max(inputD - cachedD, 0),
            output: outputD,
            cacheRead: cachedD,
            cacheWrite: 0,
          });
        }
      } else if (p.type === 'user_message' || p.type === 'agent_message') {
        out.push({
          id: `codex:${filePath}:m${idx++}`,
          isMessage: true,
          provider: 'codex',
          ts: o.timestamp ?? '',
          model,
          cwd,
          sessionId,
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        });
      }
    }
  }
  return out;
}
