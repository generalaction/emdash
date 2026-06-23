import { observer } from 'mobx-react-lite';
import { tabProviderRegistry } from '../../tabs/core/tab-provider-registry';
import { useWorkspaceViewModel } from '../../task-view-context';

export const TabDragPreview = observer(function TabDragPreview({ tabId }: { tabId: string }) {
  const { paneLayout } = useWorkspaceViewModel();
  const tab = paneLayout.groups.flatMap((g) => g.pane.resolvedTabs).find((t) => t.tabId === tabId);
  if (!tab || !tabProviderRegistry.has(tab.kind)) return null;

  const def = tabProviderRegistry.get(tab.kind);
  const DragPreviewComponent = def.DragPreview;
  return <DragPreviewComponent tab={tab} />;
});
