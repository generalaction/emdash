import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pty, PtyExitInfo } from '@main/core/pty/pty';
import { events } from '@main/lib/events';
import { conversationInitialPromptInjectionFailedChannel } from '@shared/core/conversations/conversationEvents';
import type { Conversation } from '@shared/core/conversations/conversations';
import { scheduleInitialPromptInjection } from './keystroke-injection';

vi.mock('@main/lib/events', () => ({
  events: { emit: vi.fn() },
}));

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
    vi.mocked(events.emit).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('injects after provider output goes quiet', () => {
    const { pty, write, emitData } = makePty();
    scheduleInitialPromptInjection({
      pty,
      conversation: makeConversation('hermes'),
      initialPrompt: 'Fix the bug',
      isResuming: false,
    });

    emitData('Hermes booting...');
    vi.advanceTimersByTime(200);
    emitData('still booting...');
    expect(write).not.toHaveBeenCalled();

    vi.advanceTimersByTime(900);
    expect(write).toHaveBeenCalledExactlyOnceWith('Fix the bug\r');
  });

  it('does not inject when no provider output ever arrives', () => {
    const { pty, write } = makePty();
    scheduleInitialPromptInjection({
      pty,
      conversation: makeConversation('hermes'),
      initialPrompt: 'Fix the bug',
      isResuming: false,
    });

    vi.advanceTimersByTime(15_000);
    expect(write).not.toHaveBeenCalled();
  });

  it('wraps multi-line prompts in bracketed paste sequences', () => {
    const { pty, write, emitData } = makePty();
    scheduleInitialPromptInjection({
      pty,
      conversation: makeConversation('hermes'),
      initialPrompt: 'line one\nline two',
      isResuming: false,
    });

    emitData('Hermes ready');
    vi.advanceTimersByTime(900);
    expect(write).toHaveBeenCalledExactlyOnceWith('\x1b[200~line one\nline two\x1b[201~\r');
  });

  it('does not inject into generic shell output', () => {
    const { pty, write, emitData } = makePty();
    scheduleInitialPromptInjection({
      pty,
      conversation: makeConversation('hermes'),
      initialPrompt: 'Fix the bug',
      isResuming: false,
    });

    emitData('Last login: Fri Jun 12\n% ');
    vi.advanceTimersByTime(20_000);
    expect(write).not.toHaveBeenCalled();
  });

  it('cancels injection when shell failures appear before provider output', () => {
    const { pty, write, emitData } = makePty();
    scheduleInitialPromptInjection({
      pty,
      conversation: makeConversation('hermes'),
      initialPrompt: 'Fix the bug',
      isResuming: false,
    });

    emitData('zsh:1: command not found: hermes\n% ');
    emitData('Hermes ready');
    vi.advanceTimersByTime(900);
    expect(write).not.toHaveBeenCalled();
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

  it('emits a user-visible failure event when the PTY exits before ready output', () => {
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
    expect(events.emit).toHaveBeenCalledWith(conversationInitialPromptInjectionFailedChannel, {
      conversationId: 'conv-1',
      taskId: 'task-1',
      projectId: 'proj-1',
      providerId: 'hermes',
    });
  });
});
