import { describe, expect, it } from 'vitest';
import { buildFeedbackContent } from './use-feedback-submit';

describe('buildFeedbackContent', () => {
  it('includes feedback, metadata, and app version when provided', () => {
    const content = buildFeedbackContent({
      feedback: 'Great app',
      contactEmail: 'person@example.com',
      githubUser: { login: 'octocat', name: 'Octo Cat' },
      appVersion: '1.2.3',
    });

    expect(content).toContain('Great app');
    expect(content).toContain('Contact: person@example.com');
    expect(content).toContain('GitHub: Octo Cat (@octocat)');
    expect(content).toContain('Emdash Version: 1.2.3');
  });

  it('omits empty metadata fields', () => {
    const content = buildFeedbackContent({
      feedback: 'Needs improvement',
      contactEmail: '   ',
      githubUser: null,
      appVersion: '',
    });

    expect(content).toBe('Needs improvement');
  });
});
