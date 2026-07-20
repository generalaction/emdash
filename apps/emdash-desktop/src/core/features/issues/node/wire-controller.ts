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

export function createIssuesWireController(): Controller {
  return createController(issuesContract, {
    checkConnection: ({ provider }) => checkConnection(provider),
    checkAllConnections,
    checkConfiguredConnections,
    listIssues: ({ provider, options }) => listIssues(provider, options),
    searchIssues: ({ provider, options }) => searchIssues(provider, options),
    getIssueContext: ({ provider, options }) => getIssueContext(provider, options),
  });
}
