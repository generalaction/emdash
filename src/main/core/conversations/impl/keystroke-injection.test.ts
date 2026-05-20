import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pty, PtyExitInfo } from '@main/core/pty/pty';
import type { Conversation } from '@shared/conversations';
import { scheduleInitialPromptInjection } from './keystroke-injection';

function makeConversation(providerId: Conversation['providerId']): Conversation {
  return {
    id: 'conv-1',
    projectId: 'proj-1',
    taskId: 'task-1',
    providerId,
    title: '',
    autoApprove: false,
    lastInteractedAt: null,
    isInitialConversation: false,
  };
}

function makePty(): {
  pty: Pty;
  write: ReturnType<typeof vi.fn>;
  emitData: (chunk: string) => void;
  emitExit: (info?: PtyExitInfo) => void;
} {
  const write = vi.fn();
  let dataHandler: ((data: string) => void) | undefined;
  let exitHandler: ((info: PtyExitInfo) => void) | undefined;
  const pty: Pty = {
    write,
    resize: vi.fn(),
    kill: vi.fn(),
    onData: (handler: (data: string) => void) => {
      dataHandler = handler;
    },
    onExit: (handler: (info: PtyExitInfo) => void) => {
      exitHandler = handler;
    },
  } as unknown as Pty;
  return {
    pty,
    write,
    emitData: (chunk) => dataHandler?.(chunk),
    emitExit: (info = { exitCode: 0, signal: undefined }) => exitHandler?.(info),
  };
}

describe('scheduleInitialPromptInjection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('injects after PTY output goes quiet', () => {
    const { pty, write, emitData } = makePty();
    scheduleInitialPromptInjection({
      pty,
      conversation: makeConversation('hermes'),
      initialPrompt: 'Fix the bug',
      isResuming: false,
    });

    emitData('booting...');
    vi.advanceTimersByTime(200);
    emitData('still booting...');
    expect(write).not.toHaveBeenCalled();

    vi.advanceTimersByTime(900);
    expect(write).toHaveBeenCalledExactlyOnceWith('Fix the bug\r');
  });

  it('falls back to a max wait when no output ever arrives', () => {
    const { pty, write } = makePty();
    scheduleInitialPromptInjection({
      pty,
      conversation: makeConversation('hermes'),
      initialPrompt: 'Fix the bug',
      isResuming: false,
    });

    vi.advanceTimersByTime(15_000);
    expect(write).toHaveBeenCalledExactlyOnceWith('Fix the bug\r');
  });

  it('wraps multi-line prompts in bracketed paste sequences', () => {
    const { pty, write, emitData } = makePty();
    scheduleInitialPromptInjection({
      pty,
      conversation: makeConversation('hermes'),
      initialPrompt: 'line one\nline two',
      isResuming: false,
    });

    emitData('ready');
    vi.advanceTimersByTime(900);
    expect(write).toHaveBeenCalledExactlyOnceWith('\x1b[200~line one\nline two\x1b[201~\r');
  });

  it('does nothing for OpenCode because its initial prompt is passed with --prompt', () => {
    const { pty, write, emitData } = makePty();
    scheduleInitialPromptInjection({
      pty,
      conversation: makeConversation('opencode'),
      initialPrompt: 'Fix the bug',
      isResuming: false,
    });

    emitData('ready');
    vi.advanceTimersByTime(20_000);
    expect(write).not.toHaveBeenCalled();
  });

  it('does nothing for providers without keystroke injection', () => {
    const { pty, write, emitData } = makePty();
    scheduleInitialPromptInjection({
      pty,
      conversation: makeConversation('claude'),
      initialPrompt: 'Fix the bug',
      isResuming: false,
    });

    emitData('ready');
    vi.advanceTimersByTime(20_000);
    expect(write).not.toHaveBeenCalled();
  });

  it('skips when resuming an existing session', () => {
    const { pty, write, emitData } = makePty();
    scheduleInitialPromptInjection({
      pty,
      conversation: makeConversation('hermes'),
      initialPrompt: 'Fix the bug',
      isResuming: true,
    });

    emitData('ready');
    vi.advanceTimersByTime(20_000);
    expect(write).not.toHaveBeenCalled();
  });

  it('skips when the prompt is empty or whitespace', () => {
    const { pty, write, emitData } = makePty();
    scheduleInitialPromptInjection({
      pty,
      conversation: makeConversation('hermes'),
      initialPrompt: '   ',
      isResuming: false,
    });

    emitData('ready');
    vi.advanceTimersByTime(20_000);
    expect(write).not.toHaveBeenCalled();
  });

  it('cancels injection when the PTY exits before idle', () => {
    const { pty, write, emitData, emitExit } = makePty();
    scheduleInitialPromptInjection({
      pty,
      conversation: makeConversation('hermes'),
      initialPrompt: 'Fix the bug',
      isResuming: false,
    });

    emitData('starting');
    emitExit();
    vi.advanceTimersByTime(20_000);
    expect(write).not.toHaveBeenCalled();
  });
});
