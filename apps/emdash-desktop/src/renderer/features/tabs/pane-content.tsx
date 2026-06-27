import { useDroppable } from '@dnd-kit/core';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { usePaneContext } from '../tabs/pane-context';
import { TabBar } from './tab-bar';

const CONTENT_FOCUS_SELECTOR = 'textarea, webview, [contenteditable="true"]';

function focusActiveContentElement(container: HTMLElement): void {
  for (const el of container.querySelectorAll<HTMLElement>(CONTENT_FOCUS_SELECTOR)) {
    el.focus();
    if (document.activeElement === el) return;
  }
}

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
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    pane.setContentFocuser(() => {
      if (contentRef.current) focusActiveContentElement(contentRef.current);
    });
    return () => pane.setContentFocuser(null);
  }, [pane]);

  const setContentRef = useCallback(
    (el: HTMLDivElement | null) => {
      setContentDropRef(el);
      contentRef.current = el;
    },
    [setContentDropRef]
  );

  const hasAnyTab = pane.resolvedTabs.length > 0;
  const activeKind = pane.resolvedTabs.find((t) => t.isActive)?.kind ?? null;

  if (!hasAnyTab) {
    return emptyState ?? null;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TabBar actionsSlot={actionsSlot} />
      <div ref={setContentRef} className="relative min-h-0 flex-1">
        {isOverContent && (
          <div className="pointer-events-none absolute inset-0 z-20 bg-foreground/10" />
        )}
        {pane.registry.all().map((def) => {
          const ContentComponent = def.TabContent;
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
