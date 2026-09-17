import type { VerifyResult } from '../../capabilities/auth';
import { defineIntegrationPlugin, registerIntegrationPluginBehavior } from '../../plugin';
import { DEFAULT_TASK_PATTERN, DEFAULT_TRUNK_REF, readMarkdownTasksConfig } from './config';
import { icon } from './icon';

/**
 * Tasks kept as markdown files in the repository you are already working in.
 * The connection carries no secret: verification only settles what to read
 * and from which ref, and the repository itself arrives per query as the
 * `repositoryPath` the issues plugin declares it needs.
 */
const plugin = defineIntegrationPlugin(
  {
    id: 'markdown',
    name: 'Repository tasks (markdown)',
    description: `Work on task files in this repository (default ${DEFAULT_TASK_PATTERN})`,
    websiteUrl: 'https://daringfireball.net/projects/markdown/',
  },
  {
    auth: {
      methods: [
        {
          kind: 'form',
          fields: [
            {
              id: 'taskPattern',
              label: 'Task file pattern',
              required: false,
              placeholder: DEFAULT_TASK_PATTERN,
              defaultValue: DEFAULT_TASK_PATTERN,
            },
            {
              id: 'trunkRef',
              label: 'Read from ref',
              required: false,
              placeholder: DEFAULT_TRUNK_REF,
              defaultValue: DEFAULT_TRUNK_REF,
            },
          ],
          help:
            'A repository-relative glob. Files are read from the ref so an out-of-date ' +
            'checkout never shows stale tasks; leave the ref blank to read the working tree.',
        },
      ],
    },
  },
  { icon }
);

export const provider = registerIntegrationPluginBehavior(plugin, {
  auth: {
    async verify(_host, credentials): Promise<VerifyResult> {
      const config = readMarkdownTasksConfig(credentials);
      if (!config.success) return { connected: false, error: config.error.message };
      return {
        connected: true,
        displayName: config.data.taskPattern,
        ...(config.data.trunkRef ? { displayDetail: config.data.trunkRef } : {}),
        credentials: config.data,
      };
    },
  },
});
