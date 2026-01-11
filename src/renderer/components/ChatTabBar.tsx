import React from 'react';
import { X, Plus, MessageSquare } from 'lucide-react';
import { ChatTab } from '../lib/chatTabsStore';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Spinner } from './ui/spinner';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { providerMeta } from '../providers/meta';

interface ChatTabBarProps {
  tabs: ChatTab[];
  activeTabId: string | null;
  busyTabIds?: Set<string>;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onNewTabClick: () => void;
  className?: string;
}

export function ChatTabBar({
  tabs,
  activeTabId,
  busyTabIds = new Set(),
  onTabClick,
  onTabClose,
  onNewTabClick,
  className,
}: ChatTabBarProps) {
  const handleTabClose = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation(); // Prevent tab switch when closing
    onTabClose(tabId);
  };

  return (
    <div className={cn(
      'flex h-8 items-center gap-2 border-b border-border bg-muted px-2 py-1.5',
      className
    )}>
      {/* Tab buttons container with horizontal scroll */}
      <div className="flex min-w-0 flex-1 items-center space-x-1 overflow-x-auto scrollbar-thin">
        <TooltipProvider delayDuration={250}>
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const isBusy = busyTabIds.has(tab.id);
            const meta = providerMeta[tab.providerId];

            return (
              <Tooltip key={tab.id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onTabClick(tab.id)}
                    className={cn(
                      'group flex items-center space-x-1.5 rounded px-2.5 py-1 text-xs transition-all',
                      isActive
                        ? 'border-2 border-foreground/30 bg-background text-foreground shadow-sm'
                        : 'border border-border/50 bg-transparent text-muted-foreground hover:border-border/70 hover:bg-background/50 hover:text-foreground'
                    )}
                  >
                    {/* Provider icon or fallback */}
                    {meta?.icon ? (
                      <img
                        src={meta.icon}
                        alt={tab.providerName}
                        className="h-3.5 w-3.5 shrink-0 object-contain"
                      />
                    ) : (
                      <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                    )}

                    {/* Tab title */}
                    <span className="max-w-[130px] truncate font-medium">
                      {tab.title}
                    </span>

                    {/* Dirty indicator */}
                    {tab.isDirty && (
                      <span className="text-muted-foreground">●</span>
                    )}

                    {/* Activity spinner */}
                    {isBusy && (
                      <Spinner size="sm" className="ml-1" />
                    )}

                    {/* Close button - only show if more than 1 tab */}
                    {tabs.length > 1 && (
                      <span
                        role="button"
                        tabIndex={-1}
                        onClick={(e) => handleTabClose(e, tab.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            onTabClose(tab.id);
                          }
                        }}
                        className={cn(
                          'flex h-4 w-4 items-center justify-center rounded transition-opacity',
                          isActive
                            ? 'opacity-60 hover:opacity-100'
                            : 'opacity-0 group-hover:opacity-60 group-hover:hover:opacity-100'
                        )}
                        aria-label={`Close ${tab.title}`}
                      >
                        <X className="h-3 w-3" />
                      </span>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  <div>
                    <div className="font-medium">{tab.title}</div>
                    <div className="text-muted-foreground">
                      {tab.providerName} • Created {new Date(tab.createdAt).toLocaleTimeString()}
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </TooltipProvider>
      </div>

      {/* New chat button */}
      <TooltipProvider delayDuration={250}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onNewTabClick}
              className="shrink-0"
              aria-label="New chat tab"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>New chat tab</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}