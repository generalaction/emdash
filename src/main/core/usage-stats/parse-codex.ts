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
    forked_from_id?: string;
    info?: { total_token_usage?: CodexTotals; last_token_usage?: CodexTotals };
  };
};

/**
 * Parse a Codex rollout into usage records.
 *
 * Token usage is taken from the cumulative `total_token_usage`, summed as deltas
 * between consecutive `token_count` events (robust against the ~per-turn streaming
 * updates of `last_token_usage`). Two correctness guards mirror CodexBar:
 *
 * - **Forked sessions** inherit the parent's cumulative totals, so a fork's first
 *   `token_count.total` already includes history that was billed under the parent.
 *   For forked sessions we seed the baseline at `total - last` on the first event so
 *   that inherited history isn't recounted. Non-forked sessions are unaffected.
 * - **Record ids are keyed by session id** (`codex:<sessionId>:<n>`), so the same
 *   session appearing in both `sessions/` and `archived_sessions/` collapses during
 *   the global dedup instead of double-counting. Falls back to the file path when no
 *   session id is present (never falsely merges distinct sessions).
 */
export function parseCodexRollout(text: string, filePath: string): UsageRecord[] {
  const out: UsageRecord[] = [];
  let model: string | null = null;
  let cwd: string | null = null;
  let sessionKey = filePath;
  let sessionId = filePath;
  let forked = false;
  let prevInput = 0;
  let prevCached = 0;
  let prevOutput = 0;
  let baselineApplied = false;
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
      if (p.id) {
        sessionId = p.id;
        sessionKey = p.id;
      }
      forked = Boolean(p.forked_from_id);
    } else if (o.type === 'turn_context' && p?.model) {
      model = p.model;
    } else if (o.type === 'event_msg' && p) {
      if (p.type === 'token_count' && p.info?.total_token_usage) {
        const t = p.info.total_token_usage;
        const last = p.info.last_token_usage ?? {};

        // Forked sessions: drop the inherited baseline on the first event.
        if (forked && !baselineApplied) {
          prevInput = Math.max((t.input_tokens ?? 0) - (last.input_tokens ?? 0), 0);
          prevCached = Math.max((t.cached_input_tokens ?? 0) - (last.cached_input_tokens ?? 0), 0);
          prevOutput = Math.max((t.output_tokens ?? 0) - (last.output_tokens ?? 0), 0);
          baselineApplied = true;
        }

        const inputD = Math.max((t.input_tokens ?? 0) - prevInput, 0);
        const cachedD = Math.max((t.cached_input_tokens ?? 0) - prevCached, 0);
        const outputD = Math.max((t.output_tokens ?? 0) - prevOutput, 0);
        prevInput = t.input_tokens ?? prevInput;
        prevCached = t.cached_input_tokens ?? prevCached;
        prevOutput = t.output_tokens ?? prevOutput;
        if (inputD || cachedD || outputD) {
          out.push({
            id: `codex:${sessionKey}:${idx++}`,
            isMessage: false,
            provider: 'codex',
            vendor: 'openai',
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
          id: `codex:${sessionKey}:m${idx++}`,
          isMessage: true,
          provider: 'codex',
          vendor: 'openai',
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
