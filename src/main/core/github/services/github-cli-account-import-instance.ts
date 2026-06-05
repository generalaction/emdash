import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { githubAccountRegistry } from './github-account-registry-instance';
import { GitHubCliAccountImportService } from './github-cli-account-import';
import { githubConnectionService } from './github-connection-service';

export const githubCliAccountImportService = new GitHubCliAccountImportService(
  githubAccountRegistry,
  new LocalExecutionContext(),
  githubConnectionService
);
