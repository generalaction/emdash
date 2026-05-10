import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  ProviderSessionCapability,
  TranscriptFetchArgs,
  TranscriptFetchResult,
  TranscriptItem,
  TranscriptReader,
} from './types';

/**
 * Claude Code session: `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`.
 * cwd encoding replaces `/` and `\\` with `-`. Each line is one event.
 */

class ClaudeReader implements TranscriptReader {
  async fetch(args: TranscriptFetchArgs): Promise<TranscriptFetchResult> {
    if (!args.externalSourcePath) return { items: [] };
    const raw = await readFileOrEmpty(args.externalSourcePath);
    if (!raw) return { items: [] };

    const items: TranscriptItem[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      const item = parseLine(line);
      if (item) items.push(item);
    }

    const filtered = args.since ? items.filter((i) => i.timestamp > args.since!) : items;
    const limited =
      args.limit && filtered.length > args.limit ? filtered.slice(-args.limit) : filtered;
    const last = limited[limited.length - 1];
    return { items: limited, nextCursor: last?.timestamp };
  }
}

async function readFileOrEmpty(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'ENOENT') return null;
    throw err;
  }
}

function parseLine(line: string): TranscriptItem | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const type = parsed.type;
  if (type !== 'user' && type !== 'assistant' && type !== 'system') return null;

  const id = typeof parsed.uuid === 'string' ? parsed.uuid : null;
  const timestamp = typeof parsed.timestamp === 'string' ? parsed.timestamp : null;
  if (!id || !timestamp) return null;

  const content = extractContent(parsed.message);
  if (!content) return null;

  const out: TranscriptItem = { id, role: type, timestamp, content };
  if (typeof parsed.parentUuid === 'string') out.parentId = parsed.parentUuid;
  return out;
}

function extractContent(message: unknown): string {
  if (!isRecord(message)) return '';
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (!isRecord(block)) return '';
        if (block.type === 'text' && typeof block.text === 'string') return block.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export const claudeCapability: ProviderSessionCapability = {
  acceptsSessionIdFlagAtSpawn: true,
  computeTranscriptPath: ({ home, taskPath, externalSessionId }) => {
    const encoded = taskPath.replace(/[/\\]/g, '-');
    return path.join(home, '.claude', 'projects', encoded, `${externalSessionId}.jsonl`);
  },
  reader: new ClaudeReader(),
};
