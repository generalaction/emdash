import type { GitHubAccount } from './github-account-registry';

type LegacyAccountBackfill = {
  backfillLegacyToken(): Promise<GitHubAccount | null>;
};

type CliAccountImporter = {
  importAccounts(): Promise<GitHubAccount[]>;
};

type WarningLogger = {
  warn(message: string, context: Record<string, unknown>): void;
};

export type GitHubAccountReconciliationResult = {
  legacyAccountId: string | null;
  importedCliAccountIds: string[];
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class GitHubAccountReconciliationService {
  constructor(
    private readonly deps: {
      legacyBackfill: LegacyAccountBackfill;
      cliImporter: CliAccountImporter;
      logger: WarningLogger;
    }
  ) {}

  async reconcileAtStartup(): Promise<GitHubAccountReconciliationResult> {
    const legacyAccount = await this.backfillLegacyToken();
    const cliAccounts = await this.importCliAccounts();

    return {
      legacyAccountId: legacyAccount?.id ?? null,
      importedCliAccountIds: [...new Set(cliAccounts.map((account) => account.id))],
    };
  }

  private async backfillLegacyToken(): Promise<GitHubAccount | null> {
    try {
      return await this.deps.legacyBackfill.backfillLegacyToken();
    } catch (error) {
      this.deps.logger.warn('Failed to backfill legacy GitHub account token', {
        error: errorMessage(error),
      });
      return null;
    }
  }

  private async importCliAccounts(): Promise<GitHubAccount[]> {
    try {
      return await this.deps.cliImporter.importAccounts();
    } catch (error) {
      this.deps.logger.warn('Failed to import GitHub CLI accounts during startup', {
        error: errorMessage(error),
      });
      return [];
    }
  }
}
