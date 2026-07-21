import { createController, type Controller } from '@emdash/wire/api';
import { issuesContract } from '../api';
import {
  checkAllConnections,
  checkConfiguredConnections,
  checkConnection,
  getIssueContext,
  listIssues,
  searchIssues,
} from './operations';
import type { IssueOperationsDependencies } from './operations';

export function createIssuesWireController(dependencies: IssueOperationsDependencies): Controller {
  return createController(issuesContract, {
    checkConnection: ({ provider }) => checkConnection(dependencies, provider),
    checkAllConnections: () => checkAllConnections(dependencies),
    checkConfiguredConnections: () => checkConfiguredConnections(dependencies),
    listIssues: ({ provider, options }) => listIssues(dependencies, provider, options),
    searchIssues: ({ provider, options }) => searchIssues(dependencies, provider, options),
    getIssueContext: ({ provider, options }) => getIssueContext(dependencies, provider, options),
  });
}
