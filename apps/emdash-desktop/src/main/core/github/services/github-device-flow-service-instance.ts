import { integrationPluginRegistry } from '@emdash/plugins/integrations';
import { events } from '@main/lib/events';
import { githubAccountRegistry } from '../accounts/github-account-registry-instance';
import {
  defaultGitHubDeviceAuthFactory,
  GitHubDeviceFlowService,
  type GitHubDeviceFlowConfig,
} from './github-device-flow-service';
import { githubIdentityClient } from './github-identity-client';

function resolveDeviceFlowConfig(): GitHubDeviceFlowConfig {
  const plugin = integrationPluginRegistry.get('github');
  const method = plugin?.capabilities.auth.methods.find(
    (candidate) => candidate.kind === 'oauth-device'
  );
  if (!method || method.kind !== 'oauth-device') {
    throw new Error('GitHub integration plugin does not declare an oauth-device auth method.');
  }
  return { clientId: method.clientId, scopes: method.scopes };
}

export const githubDeviceFlowService = new GitHubDeviceFlowService({
  accountRegistry: githubAccountRegistry,
  identityClient: githubIdentityClient,
  events,
  createDeviceAuth: defaultGitHubDeviceAuthFactory,
  config: resolveDeviceFlowConfig(),
});
