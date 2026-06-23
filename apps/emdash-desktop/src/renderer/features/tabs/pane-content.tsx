import { useDroppable } from '@dnd-kit/core';
import { observer } from 'mobx-react-lite';
import { type ReactNode } from 'react';
import { usePaneContext } from '../tabs/pane-context';
import { TabBar } from './tab-bar';

/** The content for a single pane: tab bar + content area. */
export const PaneContent = observer(function PaneContent({
  emptyState,
  actionsSlot,
}: {
  /** Rendered when the pane has no open tabs (domain-specific, injected by the task view). */
  emptyState?: ReactNode;
  /** Rendered in the tab bar action area (domain-specific, injected by the task view). */
  actionsSlot?: ReactNode;
}) {
  const { paneId, pane } = usePaneContext();
  const { setNodeRef: setContentDropRef, isOver: isOverContent } = useDroppable({
    id: `pane-content-${paneId}`,
  });

  const hasAnyTab = pane.resolvedTabs.length > 0;
  const activeKind = pane.resolvedTabs.find((t) => t.isActive)?.kind ?? null;

  if (!hasAnyTab) {
    return emptyState ?? null;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TabBar actionsSlot={actionsSlot} />
      <div ref={setContentDropRef} className="relative min-h-0 flex-1">
        {isOverContent && (
          <div className="pointer-events-none absolute inset-0 z-20 bg-foreground/10" />
        )}
        {pane.registry.all().map((def) => {
          const ContentComponent = def.Content;
          const isActive = activeKind === def.kind;
          return (
            <div
              key={def.kind}
              className="absolute inset-0"
              style={{ visibility: isActive ? 'visible' : 'hidden' }}
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-ignore — `inert` is a valid HTML attribute in modern browsers but not yet in React types
              inert={isActive ? undefined : ''}
            >
              <ContentComponent host={pane} ctx={pane.ctx} />
            </div>
          );
        })}
      </div>
    </div>
  );
});
