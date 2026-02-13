import React, { useState } from 'react';
import { X, Edit2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { agentConfig } from '../lib/agentConfig';
import AgentLogo from './AgentLogo';
import type { Agent } from '../types';

interface ChatTab {
  id: string;
  title: string;
  provider?: string | null;
  isActive: boolean;
  messageCount?: number;
}

interface ChatTabsProps {
  tabs: ChatTab[];
  activeTabId: string | null;
  onTabClick: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onRenameTab: (tabId: string, newTitle: string) => void;
  onDuplicateTab?: (tabId: string) => void;
}

export function ChatTabs({
  tabs,
  activeTabId,
  onTabClick,
  onCloseTab,
  onRenameTab,
}: ChatTabsProps) {
  const [draggedTab, setDraggedTab] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, tabId: string) => {
    setDraggedTab(tabId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetTabId: string) => {
    e.preventDefault();
    if (draggedTab && draggedTab !== targetTabId) {
      // TODO: Implement reordering logic
      // Will reorder ${draggedTab} to position of ${targetTabId}
    }
    setDraggedTab(null);
  };

  const handleRename = (tabId: string, currentTitle: string) => {
    const newTitle = prompt('Rename chat:', currentTitle);
    if (newTitle && newTitle.trim() && newTitle !== currentTitle) {
      onRenameTab(tabId, newTitle.trim());
    }
  };

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b bg-background/95 px-2 py-1 backdrop-blur">
      {tabs.map((tab) => {
        const config = tab.provider ? agentConfig[tab.provider as Agent] : null;
        return (
          <div
            key={tab.id}
            draggable
            onDragStart={(e) => handleDragStart(e, tab.id)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, tab.id)}
            className={cn(
              'group flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5',
              'min-w-[120px] max-w-[200px] flex-shrink-0 transition-colors',
              'hover:bg-muted/80',
              tab.id === activeTabId && 'bg-primary text-primary-foreground hover:bg-primary/90'
            )}
            onClick={() => onTabClick(tab.id)}
          >
            {config && (
              <AgentLogo
                logo={config.logo}
                alt={config.alt}
                isSvg={config.isSvg}
                invertInDark={config.invertInDark}
                className="h-4 w-4 flex-shrink-0"
              />
            )}
            <span className="flex-1 truncate text-sm font-medium" title={tab.title}>
              {tab.title}
            </span>

            <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRename(tab.id, tab.title);
                }}
                className="rounded p-0.5 hover:bg-background/20"
                title="Rename chat"
              >
                <Edit2 className="h-3 w-3" />
              </button>

              {tabs.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  className="rounded p-0.5 hover:bg-background/20"
                  title="Close chat"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
