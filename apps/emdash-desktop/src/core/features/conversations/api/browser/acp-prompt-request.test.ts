import { observable, runInAction } from 'mobx';
import { describe, expect, it } from 'vitest';
import type { AcpChatStore } from '@core/features/conversations/browser/acp/acp-chat-store';
import { requestAcpReply } from './acp-prompt-request';

// Stands in for a chat whose Wire session drops while the reply is being read back.
function storeWithFailingHistory(): AcpChatStore {
  const affordances = observable({ isWorking: false });
  return {
    affordances,
    draftText: '',
    session: {
      loadHistory: () => Promise.reject(new Error('Connection interrupted')),
    },
    submitPrompt: () => {
      runInAction(() => (affordances.isWorking = true));
      queueMicrotask(() => runInAction(() => (affordances.isWorking = false)));
    },
  } as unknown as AcpChatStore;
}

function storeThatRejects(): AcpChatStore {
  const state = observable({ isWorking: false, draftText: '' });
  return {
    affordances: state,
    get draftText() {
      return state.draftText;
    },
    session: { loadHistory: () => Promise.reject(new Error('unused')) },
    submitPrompt: (text: string) => {
      queueMicrotask(() => runInAction(() => (state.draftText = text)));
    },
  } as unknown as AcpChatStore;
}

describe('requestAcpReply', () => {
  it('resolves null right away when the prompt is rejected', async () => {
    await expect(requestAcpReply(storeThatRejects(), 'Explain', 'ctx')).resolves.toBeNull();
  });

  it('resolves null when reading the reply from history fails', async () => {
    await expect(requestAcpReply(storeWithFailingHistory(), 'Explain', 'ctx')).resolves.toBeNull();
  });
});
