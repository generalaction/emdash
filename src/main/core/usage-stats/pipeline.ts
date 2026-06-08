import { readFileSync } from 'node:fs';
import type { UsageProvider, UsageSnapshot } from '@shared/usage';
import { aggregate } from './aggregate';
import { loadIndex, reconcileCache, saveIndex } from './cache';
import { parseClaudeTranscript } from './parse-claude';
import { parseCodexRollout } from './parse-codex';
import { parsePiTranscript } from './parse-pi';
import { scanAll } from './scanner';
import type { ScannedFile, UsageRecord } from './types';

function readScannedText(file: ScannedFile): string {
  return readFileSync(file.path, 'utf8');
}

type ParseFn = (text: string, file: ScannedFile) => UsageRecord[];

// One parser per provider. Keying by the UsageProvider union makes a missing parser a
// compile error rather than silently falling through to the wrong format.
const PARSERS: Record<UsageProvider, ParseFn> = {
  claude: (text) => parseClaudeTranscript(text),
  codex: (text, file) => parseCodexRollout(text, file.path),
  pi: (text, file) => parsePiTranscript(text, file.path),
};

function parseScannedFile(text: string, file: ScannedFile): UsageRecord[] {
  return PARSERS[file.provider](text, file);
}

/**
 * The full scan -> read -> parse -> reconcile -> aggregate pass. Electron-free and
 * synchronous, so it runs identically in the utilityProcess worker (off the main thread)
 * and in the service's inline fallback. Assumes pricing rates are already installed in THIS
 * context's pricing module — the worker forwards them via setRemoteRates before calling this.
 */
export function runPipeline(indexPath: string, now: Date): UsageSnapshot {
  const prev = loadIndex(indexPath);
  const scan = scanAll();
  const { index, records } = reconcileCache(prev, scan, readScannedText, parseScannedFile);
  saveIndex(indexPath, index);
  return aggregate(records, now);
}
