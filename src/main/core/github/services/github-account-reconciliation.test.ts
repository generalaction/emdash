import { beforeEach, describe, expect, it } from 'vitest';
import { GitHubAccountReconciliationService } from './github-account-reconciliation';
import type { GitHubAccount } from './github-account-registry';

function account(id: string, credentialSource: GitHubAccount['credentialSource']): GitHubAccount {
  return {
    id,
    providerAccountId: id.split(':')[1] ?? id,
    host: id.split(':')[0] ?? 'github.com',
    login: id,
    avatarUrl: '',
    credentialSource,
    connectedAt: 1,
    updatedAt: 1,
  };
}

class LegacyBackfill {
  result: GitHubAccount | null = account('github.com:42', 'emdash_oauth');
  error: Error | null = null;

  constructor(private readonly calls: string[]) {}

  async backfillLegacyToken() {
    this.calls.push('legacy');
    if (this.error) throw this.error;
    return this.result;
  }
}

class CliImporter {
  result: GitHubAccount[] = [account('github.com:42', 'cli'), account('github.com:84', 'cli')];
  error: Error | null = null;

  constructor(private readonly calls: string[]) {}

  async importAccounts() {
    this.calls.push('cli');
    if (this.error) throw this.error;
    return this.result;
  }
}

class WarningLogger {
  warnings: Array<{ message: string; context: Record<string, unknown> }> = [];

  warn(message: string, context: Record<string, unknown>) {
    this.warnings.push({ message, context });
  }
}

describe('GitHubAccountReconciliationService', () => {
  let legacyBackfill: LegacyBackfill;
  let cliImporter: CliImporter;
  let logger: WarningLogger;
  let calls: string[];
  let service: GitHubAccountReconciliationService;

  beforeEach(() => {
    calls = [];
    legacyBackfill = new LegacyBackfill(calls);
    cliImporter = new CliImporter(calls);
    logger = new WarningLogger();
    service = new GitHubAccountReconciliationService({
      legacyBackfill,
      cliImporter,
      logger,
    });
  });

  it('backfills the legacy token before importing GitHub CLI accounts', async () => {
    const result = await service.reconcileAtStartup();

    expect(calls).toEqual(['legacy', 'cli']);
    expect(result).toEqual({
      legacyAccountId: 'github.com:42',
      importedCliAccountIds: ['github.com:42', 'github.com:84'],
    });
    expect(logger.warnings).toEqual([]);
  });

  it('still imports GitHub CLI accounts when legacy backfill fails', async () => {
    legacyBackfill.error = new Error('legacy decrypt failed');

    await expect(service.reconcileAtStartup()).resolves.toEqual({
      legacyAccountId: null,
      importedCliAccountIds: ['github.com:42', 'github.com:84'],
    });
    expect(logger.warnings).toEqual([
      {
        message: 'Failed to backfill legacy GitHub account token',
        context: { error: 'legacy decrypt failed' },
      },
    ]);
  });

  it('keeps startup running when GitHub CLI import fails', async () => {
    cliImporter.error = new Error('gh unavailable');

    await expect(service.reconcileAtStartup()).resolves.toEqual({
      legacyAccountId: 'github.com:42',
      importedCliAccountIds: [],
    });
    expect(logger.warnings).toEqual([
      {
        message: 'Failed to import GitHub CLI accounts during startup',
        context: { error: 'gh unavailable' },
      },
    ]);
  });
});
