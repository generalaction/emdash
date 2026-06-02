import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { UsageProvider } from '@shared/usage';
import type { ScannedFile } from './types';

/** Recursively collect *.jsonl under `dir`. Missing dirs yield []. */
export function scanDir(dir: string, provider: UsageProvider): ScannedFile[] {
  const out: ScannedFile[] = [];
  const walk = (current: string): void => {
    try {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          try {
            const st = statSync(full);
            out.push({ path: full, mtimeMs: st.mtimeMs, size: st.size, provider });
          } catch {
            // file vanished between readdir and stat — skip
          }
        }
      }
    } catch {
      // missing/unreadable directory — skip
    }
  };
  walk(dir);
  return out;
}

/** Default source directories for the two supported providers. */
export function defaultUsageSources(
  home = homedir()
): Array<{ dir: string; provider: UsageProvider }> {
  return [
    { dir: join(home, '.claude', 'projects'), provider: 'claude' },
    { dir: join(home, '.codex', 'sessions'), provider: 'codex' },
    { dir: join(home, '.codex', 'archived_sessions'), provider: 'codex' },
    { dir: join(home, '.pi', 'agent', 'sessions'), provider: 'pi' },
  ];
}

export function scanAll(home = homedir()): ScannedFile[] {
  return defaultUsageSources(home).flatMap((s) => scanDir(s.dir, s.provider));
}
