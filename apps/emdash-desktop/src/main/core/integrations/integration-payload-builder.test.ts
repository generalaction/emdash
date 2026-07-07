import { describe, expect, it } from 'vitest';
import { buildIntegrationListPayload } from './integration-payload-builder';

describe('buildIntegrationListPayload', () => {
  it('marks Notion as an issue integration', () => {
    const notion = buildIntegrationListPayload().find((integration) => integration.id === 'notion');

    expect(notion).toMatchObject({
      id: 'notion',
      features: expect.arrayContaining(['issues']),
      capabilities: {
        requiresRepositoryUrl: false,
        supportsIssueContext: true,
      },
    });
  });
});
