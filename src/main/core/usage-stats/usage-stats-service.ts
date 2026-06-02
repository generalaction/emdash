import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { EMPTY_USAGE_SNAPSHOT, type UsageSnapshot } from '@shared/usage';
import { aggregate } from './aggregate';
import { loadIndex, reconcileCache, saveIndex, type UsageIndex } from './cache';
import { ensureModelsDevPricing } from './models-dev';
import { parseClaudeTranscript } from './parse-claude';
import { parseCodexRollout } from './parse-codex';
import { scanAll } from './scanner';
import type { ScannedFile } from './types';

function readScannedText(file: ScannedFile): string {
  return readFileSync(file.path, 'utf8');
}

function parseScannedFile(text: string, file: ScannedFile) {
  return file.provider === 'claude'
    ? parseClaudeTranscript(text)
    : parseCodexRollout(text, file.path);
}

class UsageStatsService {
  private snapshot: UsageSnapshot = EMPTY_USAGE_SNAPSHOT;
  private indexPath = '';
  private computing: Promise<UsageSnapshot> | null = null;

  /** Fire-and-forget background warm on app start. */
  initialize(): void {
    void this.refresh().catch(() => {
      // first scan failed (e.g. no transcript dirs) — keep empty snapshot
    });
  }

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
    await ensureModelsDevPricing(); // refresh model rates (cached 24h) before pricing
    const indexPath = this.getIndexPath();
    const prev: UsageIndex = loadIndex(indexPath);
    const scan = scanAll();
    const { index, records } = reconcileCache(prev, scan, readScannedText, parseScannedFile);
    saveIndex(indexPath, index);
    this.snapshot = aggregate(records, new Date());
    return this.snapshot;
  }

  private getIndexPath(): string {
    if (!this.indexPath) this.indexPath = join(app.getPath('userData'), 'usage-index.json');
    return this.indexPath;
  }
}

export const usageStatsService = new UsageStatsService();
