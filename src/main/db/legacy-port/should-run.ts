import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { StartupDataGateStatus } from '@shared/startup-data-gate';

export type LegacyPortStatus = StartupDataGateStatus;

export interface LegacyPortStateStore {
  getStatus(): Promise<LegacyPortStatus | null>;
  setStatus(status: LegacyPortStatus): Promise<void>;
}

type LegacyPortKvSchema = {
  status: LegacyPortStatus;
};

export async function createDefaultLegacyPortStateStore(): Promise<LegacyPortStateStore> {
  const { KV } = await import('../kv');
  const kv = new KV<LegacyPortKvSchema>('legacyPort');

  return {
    getStatus: async () => kv.get('status'),
    setStatus: async (status) => kv.set('status', status),
  };
}

export function resolveLegacyPath(userDataPath: string): string {
  return join(userDataPath, 'emdash.db');
}

export function hasLegacyFile(userDataPath: string): boolean {
  return existsSync(resolveLegacyPath(userDataPath));
}
