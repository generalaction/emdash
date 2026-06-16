import { useDroppable } from '@dnd-kit/core';
import { observer } from 'mobx-react-lite';
import { useRef } from 'react';
import { BrowserPane } from '@renderer/features/browser/browser-pane';
import { ShowHide } from '@renderer/lib/ui/show-hide';
import { ChatPanel } from '../conversations/chat/chat-panel';
import { ConversationsPanel } from '../conversations/conversations-panel';
import { DiffView } from '../diff-view/main-panel/diff-view';
import { useTabGroupContext } from '../tabs/tab-group-context';
import { PaneEmptyState } from './pane-empty-state';
import { resolvePaneRenderer } from './pane-renderer';
import { FileRenderer } from './renderers/file-renderer';
import { TabBar } from './tab-bar';

/** The content for a single pane: tab bar + renderer area. */
export const PaneContent = observer(function PaneContent() {
  const { groupId, tabManager: paneTabManager } = useTabGroupContext();
  const { setNodeRef: setContentDropRef, isOver: isOverContent } = useDroppable({
    id: `pane-content-${groupId}`,
  });

  const paneRenderer = resolvePaneRenderer(paneTabManager);

  // Chat tabs are kept alive using visibility-based stacking so that:
  // 1. Each conversation gets its own ChatPanel instance, keyed by conversationId,
  //    ensuring the transcript is bound to the correct ChatStore on mount.
  // 2. Switching tabs toggles visibility (not display), preserving scroll position
  //    and the virtualizer's scroll signal — no desync, no flicker, no re-seed.
  // activatedSet tracks which chats have been viewed at least once (lazy mount).
  // Must be called unconditionally (Rules of Hooks) before any early return.
  const chatTabs = paneTabManager.resolvedTabs.filter((t) => t.kind === 'chat');
  const activatedSetRef = useRef<Set<string>>(new Set());
  for (const t of chatTabs) {
    if (t.isActive) activatedSetRef.current.add(t.conversationId);
  }

  if (!paneRenderer) {
    return <PaneEmptyState />;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TabBar />
      <div ref={setContentDropRef} className="relative min-h-0 flex-1">
        {isOverContent && (
          <div className="pointer-events-none absolute inset-0 z-20 bg-foreground/10" />
        )}
        <ShowHide visible={paneRenderer.kind === 'pty-agent'}>
          <ConversationsPanel />
        </ShowHide>

        {/* Chat pane pool — one ChatPanel per opened chat tab, visibility-toggled */}
        {chatTabs
          .filter((t) => activatedSetRef.current.has(t.conversationId))
          .map((t) => (
            <div
              key={t.conversationId}
              className="absolute inset-0"
              style={{
                visibility: t.isActive ? 'visible' : 'hidden',
                zIndex: t.isActive ? 1 : 0,
              }}
            >
              <ChatPanel conversationId={t.conversationId} />
            </div>
          ))}

        {paneRenderer.kind === 'browser' && <BrowserPane browserId={paneRenderer.browserId} />}
        {paneRenderer.kind === 'file' && <FileRenderer tab={paneRenderer.tab} />}
        {paneRenderer.kind === 'file-diff' && <DiffView tab={paneRenderer.tab} />}
      </div>
    </div>
  );
});
