import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DESIRED_WORKSPACE_SERVER_VERSION } from './desired-version';

describe('workspace-server desired version', () => {
  it('is injected from the workspace-server package metadata', () => {
    const metadata = JSON.parse(
      readFileSync(resolve(__dirname, '../../../../../../../workspace-server/package.json'), 'utf8')
    ) as { version: string };

    expect(DESIRED_WORKSPACE_SERVER_VERSION).toBe(metadata.version);
  });
});
