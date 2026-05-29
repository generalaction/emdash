import { describe, expect, it } from 'vitest';
import { parseLinearAgentDeepLink } from './deep-link';

describe('parseLinearAgentDeepLink', () => {
  it('parses Linear agent deeplinks with issue metadata', () => {
    const deepLink = parseLinearAgentDeepLink(
      'emdash://linear-agent?issue=eng-1450&projectId=project-1&agentProvider=codex&prompt=Fix%20it&issueTitle=Title&issueDescription=Desc&branchName=user/eng-1450-title'
    );

    expect(deepLink).toEqual({
      type: 'linear-agent',
      projectId: 'project-1',
      agentProvider: 'codex',
      prompt: 'Fix it',
      issue: {
        identifier: 'ENG-1450',
        url: undefined,
        title: 'Title',
        description: 'Desc',
        branchName: 'user/eng-1450-title',
      },
    });
  });

  it('extracts the issue identifier from Linear URLs and ignores invalid providers', () => {
    const deepLink = parseLinearAgentDeepLink(
      'emdash://linear/agent?url=https%3A%2F%2Flinear.app%2Fgeneral-action%2Fissue%2FENG-1450%2Ftitle&provider=unknown'
    );

    expect(deepLink?.agentProvider).toBeUndefined();
    expect(deepLink?.issue.identifier).toBe('ENG-1450');
    expect(deepLink?.issue.url).toBe('https://linear.app/general-action/issue/ENG-1450/title');
  });

  it('rejects unsupported schemes, actions, and missing identifiers', () => {
    expect(parseLinearAgentDeepLink('https://linear-agent?issue=ENG-1450')).toBeNull();
    expect(parseLinearAgentDeepLink('emdash://settings?issue=ENG-1450')).toBeNull();
    expect(parseLinearAgentDeepLink('emdash://linear-agent')).toBeNull();
  });
});
