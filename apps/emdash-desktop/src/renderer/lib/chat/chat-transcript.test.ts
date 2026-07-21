// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatTranscript } from './chat-transcript';

const chatUi = vi.hoisted(() => {
  let releaseImport: (() => void) | undefined;
  const importGate = new Promise<void>((resolve) => {
    releaseImport = resolve;
  });

  return {
    createChatView: vi.fn(() => ({ dispose: vi.fn() })),
    importGate,
    releaseImport: () => releaseImport?.(),
  };
});

vi.mock('@emdash/chat-ui', async () => {
  await chatUi.importGate;
  return { createChatView: chatUi.createChatView };
});

describe('ChatTranscript', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('creates an asynchronously loaded view with the latest props', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const firstState = { id: 'first-state' };
    const secondState = { id: 'second-state' };
    const firstCommands = { onViewImage: vi.fn() };
    const secondCommands = { onViewImage: vi.fn() };

    const renderTranscript = (state: object, commands: object) =>
      createElement(ChatTranscript, {
        context: {} as never,
        state: state as never,
        commands,
      });

    await act(async () => {
      root.render(renderTranscript(firstState, firstCommands));
    });
    await act(async () => {
      root.render(renderTranscript(secondState, secondCommands));
    });
    await act(async () => {
      chatUi.releaseImport();
      await chatUi.importGate;
    });

    expect(chatUi.createChatView).toHaveBeenCalledWith(
      expect.objectContaining({
        state: secondState,
        commands: secondCommands,
      })
    );

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});
