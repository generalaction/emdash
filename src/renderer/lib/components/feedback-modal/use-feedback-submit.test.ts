import { describe, expect, it } from 'vitest';
import { FEEDBACK_EMAIL_SCHEMA } from './schemas/feedback-email';
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

describe('FEEDBACK_EMAIL_SCHEMA', () => {
  it('accepts blank optional email', () => {
    expect(FEEDBACK_EMAIL_SCHEMA.safeParse('').success).toBe(true);
  });

  it('accepts valid email', () => {
    expect(FEEDBACK_EMAIL_SCHEMA.safeParse('person@example.com').success).toBe(true);
  });

  it('rejects invalid email', () => {
    const result = FEEDBACK_EMAIL_SCHEMA.safeParse('person');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Please enter a valid email address.');
    }
  });
});
