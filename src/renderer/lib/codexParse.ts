
export interface ParsedCodexOutput {
  reasoning?: string;
  response: string;
  actions?: string[];
  hasCodex?: boolean;
}

const TS_LINE = /^\[[0-9]{4}-[0-9]{2}-[0-9]{2}T[^\]]+\]/;

function extractActions(reasoning: string): { cleaned: string; actions: string[] } {
  if (!reasoning) return { cleaned: reasoning, actions: [] };
  const lines = reasoning.split(/\n/);
  const actions: string[] = [];
  const cleanedLines = lines.map((line) => {
    const m = line.match(/^\s*(?:[-*]\s*)?\*\*([^*]+)\*\*(.*)$/);
    if (m) {
      const title = m[1].trim();
      if (title) actions.push(title);
      return (m[2] || '').trimStart();
    }
    return line;
  });
  return { cleaned: cleanedLines.join('\n').trim(), actions };
}

export function parseCodexOutput(raw: string): ParsedCodexOutput {
  if (!raw) return { response: '' };

  const lines = raw.split(/\r?\n/);

  // Find last thinking/codex markers to support multiple blocks
  let thinkingIdx = -1;
  let codexIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (TS_LINE.test(l)) {
      const tag = l.replace(TS_LINE, '').trim().toLowerCase();
      if (tag === 'thinking') thinkingIdx = i;
      if (tag === 'codex') codexIdx = i;
    }
  }

  // If we have both markers in order, slice accordingly
  if (thinkingIdx !== -1 && codexIdx !== -1 && codexIdx > thinkingIdx) {
    const reasoning = lines
      .slice(thinkingIdx + 1, codexIdx)
      // Drop empty leading/trailing noise
      .join('\n')
      .trim();
    // Final response: from codex line to next timestamp or end
    let end = lines.length;
    for (let i = codexIdx + 1; i < lines.length; i++) {
      if (TS_LINE.test(lines[i])) {
        end = i;
        break;
      }
    }
    const response = lines
      .slice(codexIdx + 1, end)
      .join('\n')
      .trim();
    if (response || reasoning) {
      const { cleaned, actions } = extractActions(reasoning);
      return { reasoning: cleaned || undefined, response, actions };
    }
  }

  // If we only have thinking (streaming reasoning before final appears)
  if (thinkingIdx !== -1 && codexIdx === -1) {
    const reasoning = lines
      .slice(thinkingIdx + 1)
      .join('\n')
      .trim();
    const { cleaned, actions } = extractActions(reasoning);
    return { reasoning: cleaned || undefined, response: '', actions };
  }

  // If we have only a codex marker (no explicit thinking), treat everything
  // after it until the next timestamp as the final response; ignore prior headers.
  if (thinkingIdx === -1 && codexIdx !== -1) {
    let end = lines.length;
    for (let i = codexIdx + 1; i < lines.length; i++) {
      if (TS_LINE.test(lines[i])) {
        end = i;
        break;
      }
    }
    const response = lines
      .slice(codexIdx + 1, end)
      .join('\n')
      .trim();
    return { response };
  }

  // Fallback: strip known header/footer noise and return remainder as response
  const cleaned = lines
    .filter((l) => {
      const t = l.trim();
      if (!t) return false;
      // Bare (non-timestamped) header/footer lines
      if (t.startsWith('OpenAI Codex')) return false;
      if (t === '--------') return false;
      if (t.toLowerCase().startsWith('tokens used:')) return false;
      // Timestamped header/meta lines: inspect text after timestamp
      if (TS_LINE.test(t)) {
        const after = t.replace(TS_LINE, '').trim().toLowerCase();
        if (/^openai codex/.test(after)) return false;
        if (
          /^(workdir|model|provider|approval|sandbox|reasoning effort|reasoning summaries|attached files?|file:)\b/.test(
            after
          )
        )
          return false;
        if (/^user instructions:/.test(after)) return false;
        if (/^tokens used:/.test(after)) return false;
        if (/^thinking\b/.test(after)) return false;
        if (/^codex\b/.test(after)) return false;
      }
      return true;
    })
    .join('\n')
    .trim();

  return { response: cleaned };
}

// Streaming-safe parser: collects only lines within [thinking] and [codex]
// sections, and ignores tool logs (exec/bash) and headers. This avoids flashing
// user prompts or shell output during generation.
export function parseCodexStream(raw: string): ParsedCodexOutput {
  if (!raw) return { response: '' };

  // Normalize: ensure timestamps start on new lines and strip CR
  const normalized = raw
    .replace(/\r/g, '')
    .replace(/([^\n])(\[[0-9]{4}-[0-9]{2}-[0-9]{2}T[^\]]+\])/g, '$1\n$2');
  const lines = normalized.split(/\n/);

  type Section = 'none' | 'reasoning' | 'response' | 'tool' | 'ignore';
  let section: Section = 'none';
  const reasoningBuf: string[] = [];
  const responseBuf: string[] = [];
  let responseSeenReal = false;
  const pendingMeta: string[] = [];
  let codexSeen = false;

  const isHeader = (s: string) =>
    /^openai codex/i.test(s) ||
    s === '--------' ||
    /^(workdir|model|provider|approval|sandbox|reasoning effort|reasoning summaries)\s*:/i.test(
      s
    ) ||
    /^attached files?/i.test(s) ||
    /^file:\s*/i.test(s) ||
    /^tokens used:/i.test(s) ||
    /^user instructions:/i.test(s);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (TS_LINE.test(line)) {
      const after = line.replace(TS_LINE, '').trim();
      const lower = after.toLowerCase();
      if (!after || isHeader(lower)) {
        section = 'ignore';
        continue;
      }
      if (lower.startsWith('thinking')) {
        section = 'reasoning';
        continue;
      }
      if (lower.startsWith('codex')) {
        codexSeen = true;
        section = 'response';
        continue;
      }
      if (
        lower.startsWith('exec') ||
        lower.startsWith('bash') ||
        lower.startsWith('succeeded in') ||
        lower.startsWith('failed')
      ) {
        section = 'tool';
        continue;
      }
      section = 'ignore';
      continue;
    }

    // Non-timestamp lines
    const t = line.trim();
    if (!t) continue;
    if (section === 'reasoning') {
      reasoningBuf.push(line);
    } else if (section === 'response') {
      // Filter out stray reasoning/meta lines that occasionally slip in after 'codex'
      const isBoldHeading = /^\*\*[^*]+\*\*/.test(t);
      const pronounMeta =
        /^(?:I['’]m|I am|I['’]ll|I will|Let['’]s|Let us|We['’]ll|We will|We['’]re|We are|I need to|I plan to|I['’]m going to)\b/i.test(
          t
        );
      const gerundMeta =
        /^(Exploring|Analyzing|Investigating|Planning|Considering|Assessing|Reviewing|Providing)\b/i.test(
          t
        );
      const shellEcho = /^(exec\s|bash\s-?lc|succeeded in|failed)/i.test(t);
      const isMeta = isBoldHeading || pronounMeta || gerundMeta || shellEcho;

      const looksCodeFence = /^```/.test(t);
      const hasWordChars = /[A-Za-z0-9]/.test(t);
      const looksList = /^\s*(?:[-*]|\d+\.)\s+/.test(t);
      const looksHeading = /^\s*#{1,6}\s+/.test(t);
      const substantiveHeuristic =
        (hasWordChars && !isMeta) || looksCodeFence || looksList || looksHeading;

      if (!responseSeenReal) {
        if (substantiveHeuristic) {
          responseSeenReal = true;
          // Do not surface pending meta in the final response; keep it hidden
          pendingMeta.length = 0;
          responseBuf.push(line);
        } else {
          // hold off rendering until we see real content
          if (!isMeta) pendingMeta.push(line);
        }
      } else {
        responseBuf.push(line);
      }
    } else {
      // ignore tool/header noise
    }
  }

  const r = reasoningBuf.join('\n').trim();
  const { cleaned, actions } = extractActions(r);
  return {
    reasoning: cleaned || undefined,
    response: responseBuf.join('\n').trim(),
    actions,
    hasCodex: codexSeen,
  };
}
