import { useDroppable } from '@dnd-kit/core';
import { observer } from 'mobx-react-lite';
import { tabProviderRegistry } from '../tabs/core/tab-provider-registry';
import { usePaneContext } from '../tabs/pane-context';
import { PaneEmptyState } from './pane-empty-state';
import { TabBar } from './tab-bar';

/** The content for a single pane: tab bar + renderer area. */
export const PaneContent = observer(function PaneContent() {
  const { paneId, pane } = usePaneContext();
  const { setNodeRef: setContentDropRef, isOver: isOverContent } = useDroppable({
    id: `pane-content-${paneId}`,
  });

  const hasAnyTab = pane.resolvedTabs.length > 0;

  if (!hasAnyTab) {
    return <PaneEmptyState />;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TabBar />
      <div ref={setContentDropRef} className="relative min-h-0 flex-1">
        {isOverContent && (
          <div className="pointer-events-none absolute inset-0 z-20 bg-foreground/10" />
        )}
        {tabProviderRegistry.all().map((def) => {
          const RendererComponent = def.Renderer;
          return <RendererComponent key={def.kind} host={pane} ctx={pane.ctx} />;
        })}
      </div>
    </div>
  );
});
