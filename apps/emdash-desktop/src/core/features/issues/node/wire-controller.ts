import { createController, type Controller } from '@emdash/wire/api';
import { issueOperations } from '@main/core/issues/controller';
import { issuesContract } from '../api';

export function createIssuesWireController(): Controller {
  return createController(issuesContract, {
    checkConnection: ({ provider }) => issueOperations.checkConnection(provider),
    checkAllConnections: () => issueOperations.checkAllConnections(),
    checkConfiguredConnections: () => issueOperations.checkConfiguredConnections(),
    listIssues: ({ provider, options }) => issueOperations.listIssues(provider, options),
    searchIssues: ({ provider, options }) => issueOperations.searchIssues(provider, options),
    getIssueContext: ({ provider, options }) => issueOperations.getIssueContext(provider, options),
  });
}
