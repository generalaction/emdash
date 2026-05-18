import { useDroppable } from '@dnd-kit/core';
import { observer } from 'mobx-react-lite';
import { Activity } from 'react';
import { ConversationsPanel } from '../conversations/conversations-panel';
import { DiffView } from '../diff-view/main-panel/diff-view';
import { useTabGroupContext } from '../tabs/tab-group-context';
import { PaneEmptyState } from './pane-empty-state';
import { TabBar } from './tab-bar';
import { resolvePaneRenderer } from './pane-renderer';
import { FileRenderer } from './renderers/file-renderer';

/** The content for a single pane: tab bar + renderer area. */
export const PaneContent = observer(function PaneContent() {
  const { groupId, tabManager: paneTabManager } = useTabGroupContext();
  const { setNodeRef: setContentDropRef, isOver: isOverContent } = useDroppable({
    id: `pane-content-${groupId}`,
  });

  const paneRenderer = resolvePaneRenderer(paneTabManager);

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
        <Activity mode={paneRenderer.kind === 'pty-agent' ? 'visible' : 'hidden'}>
          <ConversationsPanel />
        </Activity>
        <Activity mode={paneRenderer.kind === 'file' ? 'visible' : 'hidden'}>
          {paneRenderer.kind === 'file' && <FileRenderer tab={paneRenderer.tab} />}
        </Activity>
        <Activity mode={paneRenderer.kind === 'file-diff' ? 'visible' : 'hidden'}>
          <DiffView />
        </Activity>
      </div>
    </div>
  );
});
