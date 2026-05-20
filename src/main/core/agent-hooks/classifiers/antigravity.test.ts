import { describe, expect, it } from 'vitest';
import { createAntigravityClassifier } from './antigravity';

describe('createAntigravityClassifier', () => {
  it('stays quiet while Antigravity is generating', () => {
    const classifier = createAntigravityClassifier();

    expect(classifier.classify('> haben wir hier eine AGENTS.md?\nGenerating...')).toBeUndefined();
  });

  it('emits stop when Antigravity is ready after an answer', () => {
    const classifier = createAntigravityClassifier();

    expect(
      classifier.classify(
        'It looks like you might be testing the input. How can I help you today? If you have a specific task, let me know!'
      )
    ).toEqual({
      type: 'stop',
      message: 'Antigravity is ready for input',
    });
  });

  it('emits stop for the Antigravity prompt even when prior generating text remains in the buffer', () => {
    const classifier = createAntigravityClassifier();

    expect(
      classifier.classify(
        'Generating...\nHello! I am Antigravity, your coding assistant.\nHow can I help you today?\n\n>\n? for shortcuts'
      )
    ).toEqual({
      type: 'stop',
      message: 'Antigravity is ready for input',
    });
  });

  it('emits actionable results after prior generating text remains in the buffer', () => {
    const classifier = createAntigravityClassifier();

    expect(classifier.classify('Generating...')).toBeUndefined();
    expect(classifier.classify('\nerror: failed to load configuration')).toEqual({
      type: 'error',
    });
  });

  it('does not repeat old error classifications on later chunks', () => {
    const classifier = createAntigravityClassifier();

    expect(classifier.classify('error: failed to load configuration')).toEqual({
      type: 'error',
    });
    expect(classifier.classify('\nordinary follow-up output')).toBeUndefined();
  });

  it('does not classify ordinary failed text as an error', () => {
    const classifier = createAntigravityClassifier();

    expect(
      classifier.classify('The code mentions failed login attempts and exception handling.')
    ).toBeUndefined();
  });

  it('emits auth success from the current chunk only', () => {
    const classifier = createAntigravityClassifier();

    expect(classifier.classify('Login successful')).toEqual({
      type: 'notification',
      notificationType: 'auth_success',
    });
    expect(classifier.classify('\nordinary follow-up output')).toBeUndefined();
  });
});
