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

  it('recognizes agent_end when buried beyond the 500-char tail', () => {
    const classifier = createPiClassifier();
    const padding = 'x'.repeat(800);

    expect(classifier.classify(`{"type":"agent_end","messages":[]}\n${padding}`)).toEqual({
      type: 'stop',
      message: 'Task completed',
    });
  });

  it('does not classify agent_start as a completion event', () => {
    const classifier = createPiClassifier();

    expect(classifier.classify('{"type":"agent_start"}')).toBeUndefined();
  });
});
