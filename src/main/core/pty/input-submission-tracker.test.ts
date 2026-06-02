import { describe, expect, it } from 'vitest';
import { isRealAgentPrompt, PtyInputSubmissionTracker } from './input-submission-tracker';

describe('PtyInputSubmissionTracker', () => {
  it('detects natural-language prompts submitted across chunks', () => {
    const tracker = new PtyInputSubmissionTracker();

    expect(tracker.feed('session-1', 'fix the')).toBe(false);
    expect(tracker.feed('session-1', ' bug\r')).toBe(true);
  });

  it('does not treat slash commands as agent prompts', () => {
    const tracker = new PtyInputSubmissionTracker();

    expect(tracker.feed('session-1', '/new\r')).toBe(false);
  });

  it('continues tracking after a skipped slash command', () => {
    const tracker = new PtyInputSubmissionTracker();

    expect(tracker.feed('session-1', '/model\r')).toBe(false);
    expect(tracker.feed('session-1', 'fix auth flow\r')).toBe(true);
  });

  it('treats line feed as multiline draft input, not submission', () => {
    const tracker = new PtyInputSubmissionTracker();

    expect(tracker.feed('session-1', 'fix the bug\n')).toBe(false);
    expect(tracker.feed('session-1', 'and add tests\r')).toBe(true);
  });

  it('handles backspace and line clear before submit', () => {
    const tracker = new PtyInputSubmissionTracker();

    expect(tracker.feed('session-1', '/new\x15fix bug\r')).toBe(true);
    expect(tracker.feed('session-2', '/new\x7f\x7f\x7f\x7ffix bug\r')).toBe(true);
  });
});

describe('isRealAgentPrompt', () => {
  it('filters non-task terminal submissions', () => {
    expect(isRealAgentPrompt('/new')).toBe(false);
    expect(isRealAgentPrompt('y')).toBe(false);
    expect(isRealAgentPrompt('123')).toBe(false);
    expect(isRealAgentPrompt('fix')).toBe(true);
  });
});
