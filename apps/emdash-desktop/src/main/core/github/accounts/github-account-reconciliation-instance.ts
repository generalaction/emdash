import { log } from '@main/lib/logger';
import { githubAccountBackfillService } from './github-account-backfill-instance';
import { GitHubAccountReconciliationService } from './github-account-reconciliation';
import { githubCliAccountImportService } from './github-cli-account-import-instance';
import { githubKvAccountBackfillService } from './github-kv-account-backfill-instance';

export const githubAccountReconciliationService = new GitHubAccountReconciliationService({
  kvBackfill: githubKvAccountBackfillService,
  legacyBackfill: githubAccountBackfillService,
  cliImporter: githubCliAccountImportService,
  logger: log,
});
