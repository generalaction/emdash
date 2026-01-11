import React, { useState, useEffect, useCallback, useRef } from 'react';
import ChatInterface from './ChatInterface';
import { ChatTabBar } from './ChatTabBar';
import { NewChatModal } from './NewChatModal';
import { useChatTabs } from '../lib/chatTabsStore';
import { Task } from '../types/chat';
import { Provider } from '../types';
import { useToast } from '../hooks/use-toast';
import { log } from '@/lib/logger';
import { getProviderInfo } from '../lib/providers';
import { activityStore } from '../lib/activityStore';

interface ChatInterfaceWithTabsProps {
  task: Task;
  projectName: string;
  className?: string;
  initialProvider?: Provider;
}

/**
 * Enhanced ChatInterface that supports multiple independent chat tabs within a single workspace.
 * Each tab represents a completely separate conversation with its own terminal and state.
 */
export function ChatInterfaceWithTabs({
  task,
  projectName,
  className,
  initialProvider,
}: ChatInterfaceWithTabsProps) {
  const { toast } = useToast();
  const {
    tabs,
    activeTab,
    activeTabId,
    createTab,
    setActiveTab,
    closeTab,
  } = useChatTabs(task.id);

  const [showNewTabModal, setShowNewTabModal] = useState(false);
  const [busyTabIds, setBusyTabIds] = useState<Set<string>>(new Set());
  const activityUnsubscribes = useRef<Map<string, () => void>>(new Map());

  // Initialize with first tab if none exist
  useEffect(() => {
    if (tabs.length === 0 && initialProvider && task.id) {
      log.info('[ChatInterfaceWithTabs] Creating initial tab', {
        taskId: task.id,
        provider: initialProvider
      });

      const providerInfo = getProviderInfo(initialProvider);
      const providerName = providerInfo?.name || 'Claude Code';

      createTab(initialProvider, providerName, `${providerName} Chat`);
    }
  }, [tabs.length, initialProvider, task.id, createTab]);

  // Subscribe to activity for each tab
  useEffect(() => {
    // Clean up old subscriptions
    activityUnsubscribes.current.forEach(unsub => unsub());
    activityUnsubscribes.current.clear();

    // Subscribe to each tab's activity
    tabs.forEach(tab => {
      const unsubscribe = activityStore.subscribe(tab.terminalId, (busy) => {
        setBusyTabIds(prev => {
          const next = new Set(prev);
          if (busy) {
            next.add(tab.id);
          } else {
            next.delete(tab.id);
          }
          return next;
        });
      });

      activityUnsubscribes.current.set(tab.id, unsubscribe);
    });

    // Cleanup
    return () => {
      activityUnsubscribes.current.forEach(unsub => unsub());
      activityUnsubscribes.current.clear();
    };
  }, [tabs]);

  const handleNewTab = useCallback(() => {
    setShowNewTabModal(true);
  }, []);

  const handleCreateTab = useCallback((providerId: Provider, providerName: string) => {
    log.info('[ChatInterfaceWithTabs] Creating new tab', {
      taskId: task.id,
      provider: providerId
    });

    const newTab = createTab(providerId, providerName);

    if (newTab) {
      toast({
        title: 'New Tab Created',
        description: `Started ${providerName} conversation`,
      });
    }
  }, [task.id, createTab, toast]);

  const handleTabClick = useCallback((tabId: string) => {
    log.info('[ChatInterfaceWithTabs] Switching tab', {
      taskId: task.id,
      tabId
    });
    setActiveTab(tabId);
  }, [task.id, setActiveTab]);

  const handleTabClose = useCallback(async (tabId: string) => {
    const tabToClose = tabs.find(t => t.id === tabId);
    if (!tabToClose) return;

    // Don't allow closing the last tab
    if (tabs.length === 1) {
      toast({
        title: 'Cannot close last tab',
        description: 'At least one tab must remain open',
        variant: 'destructive',
      });
      return;
    }

    log.info('[ChatInterfaceWithTabs] Closing tab', {
      taskId: task.id,
      tabId,
      terminalId: tabToClose.terminalId
    });

    // Clean up the terminal for this tab
    if (tabToClose.terminalId && (window as any).electronAPI?.ptyKill) {
      try {
        await (window as any).electronAPI.ptyKill(tabToClose.terminalId);
        log.info('[ChatInterfaceWithTabs] Terminal cleaned up', {
          terminalId: tabToClose.terminalId
        });
      } catch (error) {
        log.error('[ChatInterfaceWithTabs] Failed to clean up terminal', {
          terminalId: tabToClose.terminalId,
          error
        });
      }
    }

    // Clean up activity subscription
    const unsub = activityUnsubscribes.current.get(tabId);
    if (unsub) {
      unsub();
      activityUnsubscribes.current.delete(tabId);
    }

    // Remove from busy set
    setBusyTabIds(prev => {
      const next = new Set(prev);
      next.delete(tabId);
      return next;
    });

    closeTab(tabId);

    toast({
      title: 'Tab Closed',
      description: `Closed ${tabToClose.title}`,
    });
  }, [tabs, task.id, closeTab, toast]);

  // If no tabs exist yet, create initial tab
  if (tabs.length === 0) {
    return (
      <div className={`flex h-full items-center justify-center ${className}`}>
        <div className="text-center">
          <div className="text-muted-foreground">Initializing workspace...</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-full flex-col ${className}`}>
      {/* Tab bar */}
      <ChatTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        busyTabIds={busyTabIds}
        onTabClick={handleTabClick}
        onTabClose={handleTabClose}
        onNewTabClick={handleNewTab}
        className="flex-shrink-0"
      />

      {/* Active tab content - Only render the active tab for true isolation */}
      <div className="flex-1 min-h-0">
        {activeTab && (
          <ChatInterface
            key={activeTab.id} // Forces remount on tab change for complete isolation
            task={task}
            projectName={projectName}
            className="h-full"
            initialProvider={activeTab.providerId}
            customTerminalId={activeTab.terminalId}
            skipResume={true} // Each tab should be a fresh conversation
          />
        )}
      </div>

      {/* New Tab Modal */}
      <NewChatModal
        isOpen={showNewTabModal}
        onClose={() => setShowNewTabModal(false)}
        onCreateTab={handleCreateTab}
        defaultProvider="claude"
      />
    </div>
  );
}