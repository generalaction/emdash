import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import { createRepository, deleteRepository, listOwners } from './index';

const enabled = process.env.AGENT_GITLAB_LIVE_TEST === '1';

it.skipIf(!enabled)(
  'lists an owner and creates and deletes a repository on GitLab',
  async () => {
    const instanceUrl = process.env.AGENT_GITLAB_URL;
    const apiToken = process.env.AGENT_GITLAB_TOKEN;
    const owner = process.env.AGENT_GITLAB_OWNER;
    if (!instanceUrl || !apiToken || !owner) {
      throw new Error('Set AGENT_GITLAB_URL, AGENT_GITLAB_TOKEN, and AGENT_GITLAB_OWNER.');
    }

    const host = {
      credentials: { instanceUrl, apiToken },
      log: { debug() {}, info() {}, warn() {}, error() {} },
    } as unknown as ConnectedIntegrationHostContext;
    const name = `agent-yrf7-${randomUUID().slice(0, 8)}`;
    let created = false;

    const owners = await listOwners(host);
    expect(owners.success, owners.success ? undefined : owners.error.message).toBe(true);
    if (!owners.success) return;
    expect(owners.data.map((entry) => entry.login)).toContain(owner);

    try {
      const result = await createRepository(host, { owner, name, visibility: 'private' });
      expect(result.success, result.success ? undefined : result.error.message).toBe(true);
      if (!result.success) return;
      created = true;
      expect(result.data.nameWithOwner).toBe(`${owner}/${name}`);
      expect(result.data.cloneUrl).toContain(`${owner}/${name}.git`);
    } finally {
      if (created) {
        const result = await deleteRepository(host, { owner, name });
        expect(result.success, result.success ? undefined : result.error.message).toBe(true);
      }
    }
  },
  60_000
);
