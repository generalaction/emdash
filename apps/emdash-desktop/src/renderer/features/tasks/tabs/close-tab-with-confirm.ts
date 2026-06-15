import { getAppSettingValueSnapshot } from '@renderer/features/settings/use-app-settings-key';
import { formatConversationTitleForDisplay } from '@renderer/features/tasks/conversations/conversation-title-utils';
import type { ResolvedTab, TabManagerStore } from '@renderer/features/tasks/tabs/tab-manager-store';
import { showModal } from '@renderer/lib/modal/modal-provider';

function getTabDisplayTitle(tab: ResolvedTab): string {
  if (tab.kind === 'conversation') {
    return formatConversationTitleForDisplay(tab.store.data.providerId, tab.store.data.title);
  }
  if (tab.kind === 'chat') {
    return formatConversationTitleForDisplay(tab.store.data.providerId, tab.store.data.title);
  }
  if (tab.kind === 'browser') {
    return tab.session.title || tab.session.currentUrl || 'Browser';
  }
  return tab.path.split('/').pop() ?? 'Untitled';
}

export function closeTabWithConfirm(tabManager: TabManagerStore, tabId: string): void {
  if (!getAppSettingValueSnapshot('interface')?.confirmTabClose) {
    tabManager.closeTabWithGuard(tabId);
    return;
  }
  const tab = tabManager.resolvedTabs.find((t) => t.tabId === tabId);
  const title = tab ? getTabDisplayTitle(tab) : null;
  showModal('confirmActionModal', {
    title: 'Close tab?',
    description: title
      ? `Are you sure you want to close "${title}"?`
      : 'Are you sure you want to close this tab?',
    confirmLabel: 'Close',
    variant: 'destructive',
    onSuccess: () => tabManager.closeTabWithGuard(tabId),
  });
}

export function closeActiveTabWithConfirm(tabManager: TabManagerStore): void {
  const activeId = tabManager.activeTabId;
  if (!activeId) return;
  closeTabWithConfirm(tabManager, activeId);
}
