import { describe, expect, it } from 'vitest';
import { createPiClassifier } from './pi';

describe('createPiClassifier', () => {
  it('recognizes Pi JSON agent_end events as completion', () => {
    const classifier = createPiClassifier();

    expect(classifier.classify('{"type":"agent_end","messages":[]}')).toEqual({
      type: 'stop',
      message: 'Task completed',
    });
  });
});
