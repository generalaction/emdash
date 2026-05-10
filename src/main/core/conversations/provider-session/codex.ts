import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  CaptureMatch,
  ProviderSessionCapability,
  TranscriptFetchArgs,
  TranscriptFetchResult,
  TranscriptItem,
  TranscriptReader,
} from './types';

/**
 * Codex session: `~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<iso>-<UUID>.jsonl`
 * First line is `session_meta` with `payload.id` + `payload.cwd`.
 */

class CodexReader implements TranscriptReader {
  async fetch(args: TranscriptFetchArgs): Promise<TranscriptFetchResult> {
    if (!args.externalSourcePath) return { items: [] };
    const raw = await readFileOrEmpty(args.externalSourcePath);
    if (!raw) return { items: [] };

    const items: TranscriptItem[] = [];
    let index = 0;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      const item = parseLine(line, index++);
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

function parseLine(line: string, index: number): TranscriptItem | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.type !== 'response_item') return null;

  const timestamp = typeof parsed.timestamp === 'string' ? parsed.timestamp : null;
  if (!timestamp) return null;

  const payload = parsed.payload;
  if (!isRecord(payload) || payload.type !== 'message') return null;

  const role = payload.role;
  if (role !== 'user' && role !== 'assistant') return null;

  const content = extractContent(payload.content);
  if (!content) return null;

  // Codex doesn't stamp a uuid on every entry — synthesize from offset.
  return { id: `codex-${index}-${timestamp}`, role, timestamp, content };
}

function extractContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (!isRecord(block)) return '';
      if (typeof block.text === 'string') return block.text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

async function matchCodexFile(filePath: string, expectedCwd: string): Promise<CaptureMatch | null> {
  // Read first ~8KB; session_meta is line 1.
  let fh;
  try {
    fh = await fs.open(filePath, 'r');
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(8 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const firstLine = buf.subarray(0, bytesRead).toString('utf8').split('\n', 1)[0];
    let parsed: unknown;
    try {
      parsed = JSON.parse(firstLine);
    } catch {
      return null;
    }
    if (!isRecord(parsed) || parsed.type !== 'session_meta') return null;
    const payload = parsed.payload;
    if (!isRecord(payload)) return null;
    const id = payload.id;
    const cwd = payload.cwd;
    if (typeof id !== 'string' || typeof cwd !== 'string') return null;
    if (cwd !== expectedCwd) return null;
    return { externalSessionId: id, externalSourcePath: filePath };
  } finally {
    await fh.close();
  }
}

export const codexCapability: ProviderSessionCapability = {
  acceptsSessionIdFlagAtSpawn: false,
  capture: {
    baseDir: (home) => path.join(home, '.codex', 'sessions'),
    recursive: true,
    matchesEntry: (name) => name.startsWith('rollout-') && name.endsWith('.jsonl'),
    match: matchCodexFile,
  },
  reader: new CodexReader(),
};
