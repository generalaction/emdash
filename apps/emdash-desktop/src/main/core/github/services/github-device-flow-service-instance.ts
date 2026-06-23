import { events } from '@main/lib/events';
import { githubAccountRegistry } from '../accounts/github-account-registry-instance';
import {
  defaultGitHubDeviceAuthFactory,
  GitHubDeviceFlowService,
} from './github-device-flow-service';
import { githubIdentityClient } from './github-identity-client';

export const githubDeviceFlowService = new GitHubDeviceFlowService({
  accountRegistry: githubAccountRegistry,
  identityClient: githubIdentityClient,
  events,
  createDeviceAuth: defaultGitHubDeviceAuthFactory,
});
