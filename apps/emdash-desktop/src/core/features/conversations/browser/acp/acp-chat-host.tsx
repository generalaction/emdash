import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { AcpChatPanelBody } from './acp-chat-panel';
import { getAcpChatResourceManager } from './acp-chat-resource-manager';
import type { AcpChatStore } from './acp-chat-store';

/**
 * Cross-slice surface for hosting a live ACP chat outside the task pane's
 * tab system (for example a Multitarea grid cell showing several tasks'
 * chats side by side). Re-exported from `contributions/browser.ts` — other
 * slices should import it from there, not from this path directly.
 *
 * Acquires the conversation's AcpChatStore from the same per-task
 * AcpChatResourceManager the normal task view's tabs use — so the store's
 * ref-counted acquire/release lifecycle stays correct whether or not the
 * same conversation is also open in a task tab elsewhere — bootstraps it,
 * and releases it on unmount, mirroring what AcpChatTabResource does for a
 * tab's lifecycle.
 */
export const AcpConversationChat = observer(function AcpConversationChat({
  projectId,
  taskId,
  conversationId,
}: {
  projectId: string;
  taskId: string;
  conversationId: string;
}) {
  const [store, setStore] = useState<AcpChatStore | null>(null);

  useEffect(() => {
    const manager = getAcpChatResourceManager(taskId, projectId);
    const acquired = manager.acquire(conversationId);
    acquired.bootstrap();
    setStore(acquired);
    return () => {
      manager.release(conversationId);
    };
  }, [projectId, taskId, conversationId]);

  if (!store) return null;
  return <AcpChatPanelBody store={store} />;
});
