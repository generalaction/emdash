import { describe, expect, it } from 'vitest';
import { inferTaskNameFromContext } from '../../renderer/lib/taskNames';

describe('taskNames context inference', () => {
  it('infers a descriptive name from initial prompt text', () => {
    const inferred = inferTaskNameFromContext({
      initialPrompt: 'Please fix login redirect bug on mobile Safari.',
    });

    expect(inferred).toContain('login');
    expect(inferred).toContain('redirect');
    expect(inferred).toContain('mobile');
  });

  it('uses issue identifiers when available', () => {
    const inferred = inferTaskNameFromContext({
      githubIssue: {
        number: 1033,
        title: 'Auto-infer workspace names from conversation context',
      },
    });

    expect(inferred.startsWith('gh-1033-')).toBe(true);
    expect(inferred).toContain('workspace');
  });

  it('returns unique names when the inferred name already exists', () => {
    const context = {
      initialPrompt: 'Fix login redirect bug on mobile Safari',
    };
    const first = inferTaskNameFromContext(context);
    const second = inferTaskNameFromContext(context, [first]);

    expect(first).not.toBe(second);
    expect(second.startsWith(`${first}-`)).toBe(true);
  });

  it('falls back to provided fallback name when context is empty', () => {
    const inferred = inferTaskNameFromContext({}, [], { fallbackName: 'investigate-performance' });
    expect(inferred).toBe('investigate-performance');
  });
});
