import { describe, expect, it } from 'vitest';
import { createCursorClassifier } from './cursor';

describe('createCursorClassifier', () => {
  it('detects agent thinking as start', () => {
    const classifier = createCursorClassifier();
    const result = classifier.classify('… Thought for 213ms\n');
    expect(result).toEqual({ type: 'start' });
  });

  it('detects idle follow-up prompt when hooks do not handle stop', () => {
    const classifier = createCursorClassifier();
    const result = classifier.classify('→ Add a follow-up\n');
    expect(result).toEqual({
      type: 'notification',
      notificationType: 'idle_prompt',
    });
  });

  it('ignores idle follow-up when hooks handle stop', () => {
    const classifier = createCursorClassifier({ hooksHandleStop: true });
    const result = classifier.classify('→ Add a follow-up\n');
    expect(result).toBeUndefined();
  });
});
