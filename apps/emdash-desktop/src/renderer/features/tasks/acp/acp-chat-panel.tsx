/**
 * AcpChatPanel — Content component for the 'acp-chat' tab kind.
 *
 * Mount-all pattern: one instance per pane (regardless of how many acp-chat
 * tabs are open), visibility controlled by PaneContent's absolute/inert wrapper.
 *
 * Layout:
 *   ┌──────────────────────────────────┐
 *   │  ChatTranscript (fills parent)   │
 *   │  ┌────────────────────────────┐  │
 *   │  │ composer slot (sticky bot) │  │  ← rendered inside the Solid root
 *   │  └────────────────────────────┘  │     portaled via createPortal
 *   └──────────────────────────────────┘
 *
 * The composer slot is a sticky bottom div inside ChatTranscript. ChatView's
 * internal ResizeObserver drives padBottom automatically so the transcript
 * content stays clear of the composer. No external ResizeObserver needed.
 */

import { ChatTranscript } from '@emdash/ui/react/chat-ui';
import type { ChatView } from '@emdash/ui/react/chat-ui';
import { ChatComposer } from '@emdash/ui/react/components';
import type { ComposerPermissionRequest } from '@emdash/ui/react/components';
import { observer } from 'mobx-react-lite';
import { useCallback, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { usePaneContext } from '@renderer/features/tabs/pane-context';
import type { AcpChatStore } from './acp-chat-store';
import type { AcpChatTabResource } from './acp-chat-tab-resource';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Map an AcpPermissionRequest to the ComposerPermissionRequest shape the UI expects. */
function toComposerPermission(
  req: AcpChatStore['permissionQueue'][number] | undefined
): ComposerPermissionRequest | null {
  if (!req) return null;
  return {
    requestId: req.requestId,
    title: req.title,
    options: req.options.map((o) => ({
      optionId: o.optionId,
      name: o.name,
      kind: o.kind,
    })),
  };
}

// ── Inner panel for a single store ────────────────────────────────────────────

const AcpChatStorePanel = observer(function AcpChatStorePanel({ store }: { store: AcpChatStore }) {
  const [composerSlot, setComposerSlot] = useState<HTMLElement | null>(null);

  const handleReady = useCallback(
    (view: ChatView) => {
      store.attachView(view);
      setComposerSlot(view.composerSlot);
    },
    [store]
  );

  const handleSubmit = useCallback(
    (value: string) => {
      if (!value.trim()) return;
      store.submitPrompt(value);
    },
    [store]
  );

  const handleStop = useCallback(() => {
    store.stop();
  }, [store]);

  const handleResolvePermission = useCallback(
    (optionId: string | null) => {
      store.resolvePermission(optionId);
    },
    [store]
  );

  const a = store.affordances;
  const permissionRequest = toComposerPermission(store.permissionQueue[0]);

  return (
    <div
      className="relative h-full overflow-hidden"
      style={{ backgroundColor: 'var(--surface-paper)' }}
    >
      <ChatTranscript
        context={store.chatContext}
        state={store.chatState}
        composer="slot"
        stickToBottom
        pinUserMessages
        onReady={handleReady}
        style={{ position: 'absolute', inset: 0 }}
      />
      {composerSlot &&
        createPortal(
          <div style={{ '--composer-bg': 'var(--surface-paper)' } as CSSProperties}>
            <ChatComposer
              isWorking={a.isWorking}
              canSubmit={a.canSubmit}
              onSubmit={handleSubmit}
              onStop={a.isWorking ? handleStop : undefined}
              permissionRequest={permissionRequest}
              permissionQueueCount={store.permissionQueue.length}
              onResolvePermission={handleResolvePermission}
            />
          </div>,
          composerSlot
        )}
    </div>
  );
});

// ── Root Content component ────────────────────────────────────────────────────

export const AcpChatPanel = observer(function AcpChatPanel() {
  const { pane } = usePaneContext();

  const activeTab = pane.resolvedTabs.find((t) => t.isActive && t.kind === 'acp-chat');
  if (!activeTab) return null;

  const resource = activeTab.resource as AcpChatTabResource;
  const store: AcpChatStore = resource.store;
  const conversationId = store.conversationId;

  return <AcpChatStorePanel key={conversationId} store={store} />;
});
