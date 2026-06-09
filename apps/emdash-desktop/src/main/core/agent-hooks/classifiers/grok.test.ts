import { describe, expect, it } from 'vitest';
import { createGrokClassifier } from './grok';

describe('createGrokClassifier', () => {
  it('recognizes approval prompts', () => {
    const classifier = createGrokClassifier();

    expect(classifier.classify('Allow command execution?')).toEqual({
      type: 'notification',
      notificationType: 'permission_prompt',
    });
  });

  it('does not treat permission-mode flags as approval prompts', () => {
    const classifier = createGrokClassifier();

    expect(classifier.classify('grok --permission-mode dontAsk')).toBeUndefined();
  });
});
