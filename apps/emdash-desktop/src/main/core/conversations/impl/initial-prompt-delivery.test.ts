import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pty } from '@main/core/pty/pty';
import { providerConfigDefaults } from '@main/core/settings/schema';
import { createInitialPromptDelivery } from './initial-prompt-delivery';

function makePtyMock(): { pty: Pty; writes: string[] } {
  const writes: string[] = [];
  const pty = {
    write: (data: string) => {
      writes.push(data);
    },
    resize: () => {},
    kill: () => {},
    onData: () => () => {},
    onExit: () => () => {},
  } as unknown as Pty;
  return { pty, writes };
}

describe('createInitialPromptDelivery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('argv-provider on fresh session returns prompt as argv tokens and no-op afterSpawn', () => {
    const delivery = createInitialPromptDelivery({
      providerId: 'codex',
      conversationId: 'conv-1',
      providerConfig: providerConfigDefaults.codex,
      initialPrompt: 'Fix the bug',
      isResuming: false,
    });

    expect(delivery.argvAddition()).toEqual(['Fix the bug']);

    const { pty, writes } = makePtyMock();
    delivery.afterSpawn(pty);
    vi.runAllTimers();
    expect(writes).toEqual([]);
  });

  it('argv-provider with multi-token initialPromptFlag splits the flag', () => {
    const delivery = createInitialPromptDelivery({
      providerId: 'goose',
      conversationId: 'conv-1',
      providerConfig: providerConfigDefaults.goose,
      initialPrompt: 'Fix the bug',
      isResuming: false,
    });

    expect(delivery.argvAddition()).toEqual(['-t', 'Fix the bug']);
  });

  it('keystroke-provider on fresh session keeps argv empty and writes to PTY after delay', () => {
    const delivery = createInitialPromptDelivery({
      providerId: 'grok',
      conversationId: 'conv-1',
      providerConfig: providerConfigDefaults.grok,
      initialPrompt: 'Hello agent',
      isResuming: false,
    });

    expect(delivery.argvAddition()).toEqual([]);

    const { pty, writes } = makePtyMock();
    delivery.afterSpawn(pty);
    expect(writes).toEqual([]);
    vi.runAllTimers();
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.join('')).toContain('Hello agent');
  });

  it('returns no-op delivery when resuming, regardless of provider', () => {
    const argv = createInitialPromptDelivery({
      providerId: 'codex',
      conversationId: 'conv-1',
      providerConfig: providerConfigDefaults.codex,
      initialPrompt: 'Fix the bug',
      isResuming: true,
    });
    const keystroke = createInitialPromptDelivery({
      providerId: 'grok',
      conversationId: 'conv-1',
      providerConfig: providerConfigDefaults.grok,
      initialPrompt: 'Hello agent',
      isResuming: true,
    });

    for (const delivery of [argv, keystroke]) {
      expect(delivery.argvAddition()).toEqual([]);
      const { pty, writes } = makePtyMock();
      delivery.afterSpawn(pty);
      vi.runAllTimers();
      expect(writes).toEqual([]);
    }
  });

  it('returns no-op delivery when prompt is empty or whitespace', () => {
    for (const prompt of [undefined, '', '   ']) {
      const delivery = createInitialPromptDelivery({
        providerId: 'codex',
        conversationId: 'conv-1',
        providerConfig: providerConfigDefaults.codex,
        initialPrompt: prompt,
        isResuming: false,
      });

      expect(delivery.argvAddition()).toEqual([]);
      const { pty, writes } = makePtyMock();
      delivery.afterSpawn(pty);
      vi.runAllTimers();
      expect(writes).toEqual([]);
    }
  });
});
