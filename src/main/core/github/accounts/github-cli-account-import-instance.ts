import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { githubConnectionService } from '../services/github-connection-service';
import { githubAccountRegistry } from './github-account-registry-instance';
import { GitHubCliAccountImportService } from './github-cli-account-import';

export const githubCliAccountImportService = new GitHubCliAccountImportService(
  githubAccountRegistry,
  new LocalExecutionContext(),
  githubConnectionService
);
