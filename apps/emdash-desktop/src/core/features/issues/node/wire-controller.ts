import { createController, type Controller } from '@emdash/wire/rpc';
import { issuesContract } from '../api';
import type { JiraSyncResult } from '../api/jira-sync';
import {
  checkAllConnections,
  checkConnection,
  getIssueContext,
  listIssues,
  searchIssues,
} from './operations';
import type { IssueOperationsDependencies } from './operations';

export function createIssuesWireController(
  dependencies: IssueOperationsDependencies,
  syncAssignedJiraIssues: (projectId: string) => Promise<JiraSyncResult>
): Controller {
  return createController(issuesContract, {
    syncAssignedJiraIssues: ({ projectId }) => syncAssignedJiraIssues(projectId),
    checkConnection: ({ provider }) => checkConnection(dependencies, provider),
    checkAllConnections: () => checkAllConnections(dependencies),
    listIssues: ({ provider, options }) => listIssues(dependencies, provider, options),
    searchIssues: ({ provider, options }) => searchIssues(dependencies, provider, options),
    getIssueContext: ({ provider, options }) => getIssueContext(dependencies, provider, options),
  });
}
