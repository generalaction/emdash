import { describe, expect, it } from 'vitest';
import { createCodexClassifier } from './codex';

describe('createCodexClassifier', () => {
  it('recognizes classic Codex completion text', () => {
    const classifier = createCodexClassifier();

    expect(classifier.classify('All set')).toEqual({
      type: 'stop',
      message: 'Task completed',
    });
  });

  it('recognizes completed goal footer status as completion', () => {
    const classifier = createCodexClassifier();

    expect(classifier.classify('Goal achieved (10h 12m)')).toEqual({
      type: 'stop',
      message: 'Task completed',
    });
  });

  it('recognizes stopped incomplete goal footer statuses as completion', () => {
    const classifier = createCodexClassifier();

    expect(classifier.classify('Goal unmet (63.9K / 50K tokens)')).toEqual({
      type: 'stop',
      message: 'Task completed',
    });
    expect(classifier.classify('Goal abandoned')).toEqual({
      type: 'stop',
      message: 'Task completed',
    });
  });

  it('does not treat active or paused goals as completion', () => {
    const classifier = createCodexClassifier();

    expect(classifier.classify('Pursuing goal (2m)')).toBeUndefined();
    expect(classifier.classify('Goal paused (/goal resume)')).toBeUndefined();
  });
});
