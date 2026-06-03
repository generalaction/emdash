import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { EMPTY_USAGE_SNAPSHOT, type UsageProvider, type UsageSnapshot } from '@shared/usage';
import { aggregate } from './aggregate';
import { loadIndex, reconcileCache, saveIndex, type UsageIndex } from './cache';
import { ensureModelsDevPricing } from './models-dev';
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

class UsageStatsService {
  private snapshot: UsageSnapshot = EMPTY_USAGE_SNAPSHOT;
  private indexPath = '';
  private computing: Promise<UsageSnapshot> | null = null;

  /**
   * Lazily computes on first access, then serves the cached snapshot. We do NOT warm
   * on app start: a cold cache scans/parses every local transcript (potentially GBs of
   * JSONL) and that work is synchronous, so warming eagerly would block the main process
   * during startup. The first Usage-tab open pays the cost instead, behind a spinner.
   */
  async getSnapshot(): Promise<UsageSnapshot> {
    if (this.snapshot.generatedAt === '') return this.refresh();
    return this.snapshot;
  }

  refresh(): Promise<UsageSnapshot> {
    if (this.computing) return this.computing;
    this.computing = this.compute().finally(() => {
      this.computing = null;
    });
    return this.computing;
  }

  private async compute(): Promise<UsageSnapshot> {
    // Refresh rates (cached 24h) in parallel with the disk scan — they're independent, and
    // only aggregate() consumes pricing, so we just await it before pricing the records.
    const pricing = ensureModelsDevPricing();
    const indexPath = this.getIndexPath();
    const prev: UsageIndex = loadIndex(indexPath);
    const scan = scanAll();
    const { index, records } = reconcileCache(prev, scan, readScannedText, parseScannedFile);
    saveIndex(indexPath, index);
    await pricing;
    this.snapshot = aggregate(records, new Date());
    return this.snapshot;
  }

  private getIndexPath(): string {
    if (!this.indexPath) this.indexPath = join(app.getPath('userData'), 'usage-index.json');
    return this.indexPath;
  }
}

export const usageStatsService = new UsageStatsService();
