import { describe, expect, it } from 'vitest';
import { defaultHookEventParser } from './parse-hook-event';

describe('defaultHookEventParser', () => {
  it('maps tool-use events to working status events', () => {
    expect(defaultHookEventParser('tool-use', { message: 'ran shell' })).toEqual({
      kind: 'status',
      type: 'start',
      lastAssistantMessage: undefined,
      title: undefined,
      message: 'ran shell',
    });
  });

  it('maps tool-use-failure events to error status events', () => {
    expect(defaultHookEventParser('tool-use-failure', { title: 'Tool failed' })).toEqual({
      kind: 'status',
      type: 'error',
      lastAssistantMessage: undefined,
      title: 'Tool failed',
      message: undefined,
    });
  });
});
