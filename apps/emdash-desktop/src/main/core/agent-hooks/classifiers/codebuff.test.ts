import { describe, expect, it } from 'vitest';
import { createCodebuffClassifier, createFreebuffClassifier } from './codebuff';

describe('createCodebuffClassifier', () => {
  it('recognizes Codebuff idle prompts', () => {
    const classifier = createCodebuffClassifier();

    expect(classifier.classify('codebuff >')).toEqual({
      type: 'notification',
      notificationType: 'idle_prompt',
    });
  });
});

describe('createFreebuffClassifier', () => {
  it('recognizes Freebuff idle prompts', () => {
    const classifier = createFreebuffClassifier();

    expect(classifier.classify('freebuff >')).toEqual({
      type: 'notification',
      notificationType: 'idle_prompt',
    });
  });
});
