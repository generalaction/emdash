import fs from 'fs/promises';
import path from 'path';
import { app } from 'electron';

export interface ProviderStatus {
  installed: boolean;
  path?: string | null;
  version?: string | null;
  lastChecked: number;
}

type ProviderStatusMap = Record<string, ProviderStatus>;

export class ProviderStatusCache {
  private cache: ProviderStatusMap = {};
  private filePath: string | null = null;
  private persistPromise: Promise<void> | null = null;
  private pendingPersist = false;

  constructor() {
    // lazily resolved in load/persist to avoid app readiness issues
  }

  async load(): Promise<void> {
    if (!this.filePath) {
      this.filePath = path.join(app.getPath('userData'), 'provider-status-cache.json');
    }
    if (!this.filePath) return;
    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object') {
        this.cache = parsed as ProviderStatusMap;
      }
    } catch {
      this.cache = {};
    }
  }

  getAll(): ProviderStatusMap {
    return { ...this.cache };
  }

  get(providerId: string): ProviderStatus | undefined {
    return this.cache[providerId];
  }

  set(providerId: string, status: ProviderStatus): void {
    this.cache = {
      ...this.cache,
      [providerId]: status,
    };
    this.persist();
  }

  private persist() {
    if (!this.filePath) {
      this.filePath = path.join(app.getPath('userData'), 'provider-status-cache.json');
    }
    if (!this.filePath) return;

    if (this.persistPromise) {
      this.pendingPersist = true;
      return;
    }
    const write = () => {
      const payload = JSON.stringify(this.cache, null, 2);
      this.persistPromise = fs
        .writeFile(this.filePath as string, payload, 'utf8')
        .catch(() => {})
        .finally(() => {
          this.persistPromise = null;
          if (this.pendingPersist) {
            this.pendingPersist = false;
            write();
          }
        });
    };
    write();
  }
}

export const providerStatusCache = new ProviderStatusCache();
