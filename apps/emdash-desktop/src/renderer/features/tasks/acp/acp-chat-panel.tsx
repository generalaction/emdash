/**
 * AcpChatPanel — Content component for the 'acp-chat' tab kind.
 *
 * Mount-all pattern: one instance per pane (regardless of how many acp-chat
 * tabs are open), visibility controlled by PaneContent's absolute/inert wrapper.
 *
 * Layout:
 *   ┌──────────────────────────────────┐
 *   │  ChatTranscript (flex-1)         │
 *   ├──────────────────────────────────┤
 *   │  ChatComposer (auto-height)      │
 *   └──────────────────────────────────┘
 */

import { ChatComposer } from '@emdash/ui/react/components';
import type { ComposerPermissionRequest } from '@emdash/ui/react/components';
import { ChatTranscript } from '@emdash/ui/react/chat-ui';
import type { ChatHandle } from '@emdash/ui/react/chat-ui';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { usePaneContext } from '@renderer/features/tabs/pane-context';
import type { AcpChatResolvedData } from './acp-chat-tab-provider';
import type { AcpChatStore } from './acp-chat-store';

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

const AcpChatStorePanel = observer(function AcpChatStorePanel({
  store,
}: {
  store: AcpChatStore;
}) {
  const composerRef = useRef<HTMLDivElement>(null);
  const [padBottom, setPadBottom] = useState(0);

  // Measure the composer height for ChatTranscript padBottom.
  useEffect(() => {
    if (!composerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height ?? 0;
      setPadBottom(height);
    });
    observer.observe(composerRef.current);
    return () => observer.disconnect();
  }, []);

  const handleReady = useCallback(
    (handle: ChatHandle) => {
      store.attachHandle(handle);
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

  const isWorking = store.lifecycle === 'working';
  const isReady = store.lifecycle === 'ready' || isWorking;
  const permissionRequest = toComposerPermission(store.permissionQueue[0]);

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      style={{ backgroundColor: 'var(--surface-paper)' }}
    >
      <div className="min-h-0 flex-1">
        <ChatTranscript padBottom={padBottom} pinUserMessages onReady={handleReady} />
      </div>
      {/* Match the composer background to the tab's paper background. */}
      <div ref={composerRef} style={{ '--composer-bg': 'var(--surface-paper)' } as CSSProperties}>
        <ChatComposer
          isWorking={isWorking}
          canSubmit={isReady}
          onSubmit={handleSubmit}
          onStop={isWorking ? handleStop : undefined}
          permissionRequest={permissionRequest}
          permissionQueueCount={store.permissionQueue.length}
          onResolvePermission={handleResolvePermission}
        />
      </div>
    </div>
  );
});

// ── Root Content component ────────────────────────────────────────────────────

export const AcpChatPanel = observer(function AcpChatPanel() {
  const { pane } = usePaneContext();

  const activeTab = pane.resolvedTabs.find(
    (t): t is typeof t & AcpChatResolvedData => t.isActive && t.kind === 'acp-chat'
  ) as (typeof pane.resolvedTabs[0] & AcpChatResolvedData) | undefined;

  if (!activeTab) return null;

  const store = activeTab.store;

  // Ensure the store is bootstrapped once when it becomes the active tab.
  // bootstrap() is idempotent.
  store.bootstrap();

  return <AcpChatStorePanel key={activeTab.conversationId} store={store} />;
});
