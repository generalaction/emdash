import { describe, expect, it } from 'vitest';
import { createAmpClassifier } from './amp';

describe('createAmpClassifier', () => {
  it('recognizes the interactive prompt as idle', () => {
    const classifier = createAmpClassifier();

    expect(classifier.classify('Done.\n\n> ')).toEqual({
      type: 'notification',
      notificationType: 'idle_prompt',
    });
  });
});
