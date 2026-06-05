import { githubAccountRegistry } from './github-account-registry-instance';
import { GitHubAccountService } from './github-account-service';
import { githubCliAccountImportService } from './github-cli-account-import-instance';

export const githubAccountService = new GitHubAccountService(
  githubAccountRegistry,
  githubCliAccountImportService
);
