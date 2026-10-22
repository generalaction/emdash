import { definePullRequestsPlugin, registerPullRequestsPluginBehavior } from '../../plugin';
import { GitLabPullRequestClient } from './client';

const plugin = definePullRequestsPlugin({ integrationId: 'gitlab' }, { pullRequests: {} }, {});

export const provider = registerPullRequestsPluginBehavior(plugin, {
  pullRequests: { createClient: (host) => new GitLabPullRequestClient(host) },
});
