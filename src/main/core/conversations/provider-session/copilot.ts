import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type {
  CaptureMatch,
  ProviderSessionCapability,
  TranscriptFetchArgs,
  TranscriptFetchResult,
  TranscriptItem,
  TranscriptReader,
} from './types';

/**
 * GitHub Copilot CLI session.
 *
 *   sessions live in `~/.copilot/session-state/<UUID>/` (workspace.yaml,
 *   checkpoints/, files/, research/) and message turns live in a shared
 *   sqlite db at `~/.copilot/session-store.db` (table `turns` with one row
 *   per user/assistant exchange).
 *
 *   externalSourcePath = the session-state directory. The reader doesn't
 *   need the path itself — it uses externalSessionId as the sqlite filter —
 *   but we capture the dir path anyway for diagnostics.
 */

const DB_PATH = path.join(homedir(), '.copilot', 'session-store.db');

interface TurnRow {
  turn_index: number;
  user_message: string | null;
  assistant_response: string | null;
  timestamp: string;
}

class CopilotReader implements TranscriptReader {
  async fetch(args: TranscriptFetchArgs): Promise<TranscriptFetchResult> {
    let db: Database.Database;
    try {
      db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'SQLITE_CANTOPEN') return { items: [] };
      throw err;
    }
    try {
      const rows = db
        .prepare<
          [string],
          TurnRow
        >('SELECT turn_index, user_message, assistant_response, timestamp FROM turns WHERE session_id = ? ORDER BY turn_index ASC')
        .all(args.externalSessionId);

      const items: TranscriptItem[] = [];
      for (const row of rows) {
        if (row.user_message) {
          items.push({
            id: `copilot-${args.externalSessionId}-${row.turn_index}-u`,
            role: 'user',
            timestamp: row.timestamp,
            content: row.user_message,
          });
        }
        if (row.assistant_response) {
          items.push({
            id: `copilot-${args.externalSessionId}-${row.turn_index}-a`,
            role: 'assistant',
            timestamp: row.timestamp,
            content: row.assistant_response,
          });
        }
      }

      const filtered = args.since ? items.filter((i) => i.timestamp > args.since!) : items;
      const limited =
        args.limit && filtered.length > args.limit ? filtered.slice(-args.limit) : filtered;
      const last = limited[limited.length - 1];
      return { items: limited, nextCursor: last?.timestamp };
    } finally {
      db.close();
    }
  }
}

async function matchCopilotDir(dirPath: string, expectedCwd: string): Promise<CaptureMatch | null> {
  // Each session-state subdir has a workspace.yaml with `id:` and `cwd:` fields.
  const yamlPath = path.join(dirPath, 'workspace.yaml');
  let raw: string;
  try {
    raw = await fs.readFile(yamlPath, 'utf8');
  } catch {
    return null;
  }

  // Lightweight YAML scan — copilot's workspace.yaml is flat scalar pairs.
  const lines = raw.split('\n');
  let id: string | null = null;
  let cwd: string | null = null;
  for (const line of lines) {
    const m = /^([\w_]+):\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    if (m[1] === 'id') id = stripQuotes(m[2]);
    else if (m[1] === 'cwd') cwd = stripQuotes(m[2]);
  }
  if (!id || !cwd) return null;
  if (cwd !== expectedCwd) return null;
  return { externalSessionId: id, externalSourcePath: dirPath };
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

export const copilotCapability: ProviderSessionCapability = {
  acceptsSessionIdFlagAtSpawn: false,
  capture: {
    baseDir: (home) => path.join(home, '.copilot', 'session-state'),
    matchesEntry: (name) => /^[0-9a-f-]{36}$/i.test(name),
    match: matchCopilotDir,
  },
  reader: new CopilotReader(),
};
