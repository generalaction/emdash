import { definePullRequestsPlugin, registerPullRequestsPluginBehavior } from '../../plugin';
import { GitHubPullRequestClient } from './client';

const plugin = definePullRequestsPlugin({ integrationId: 'github' }, { pullRequests: {} }, {});

export const provider = registerPullRequestsPluginBehavior(plugin, {
  pullRequests: {
    createClient: (host) => new GitHubPullRequestClient(host),
  },
});
