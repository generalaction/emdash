import React, { useState } from 'react';
import { X, Terminal } from 'lucide-react';
import type { Conversation } from '../types/chat';
import { cn } from '../lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from './ui/tooltip';
import { NewConversationButton } from './NewConversationButton';
import type { ProviderId } from '@shared/providers/registry';

interface ConversationTabsProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  workspaceId: string;
  onCreateConversationWithProvider: (provider: ProviderId | null) => void;
  onRenameConversation: (id: string, newTitle: string) => void;
  onDeleteConversation: (id: string) => void;
  isBusy?: boolean;
  providerIcon?: string;
  providerLabel?: string;
}

export const ConversationTabs: React.FC<ConversationTabsProps> = ({
  conversations,
  activeConversationId,
  onSelectConversation,
  workspaceId,
  onCreateConversationWithProvider,
  onRenameConversation,
  onDeleteConversation,
  isBusy = false,
  providerIcon,
  providerLabel,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const handleDoubleClick = (conversation: Conversation) => {
    setEditingId(conversation.id);
    setEditingTitle(conversation.title);
  };

  const handleRenameSubmit = (id: string) => {
    if (editingTitle.trim() && editingTitle !== conversations.find(c => c.id === id)?.title) {
      onRenameConversation(id, editingTitle.trim());
    }
    setEditingId(null);
    setEditingTitle('');
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRenameSubmit(id);
    } else if (e.key === 'Escape') {
      setEditingId(null);
      setEditingTitle('');
    }
  };

  return (
    <TooltipProvider>
      <div className="flex items-center border-b border-border bg-background px-5 py-1.5">
        <div className="flex items-center gap-0.5 flex-1 overflow-x-auto scrollbar-hide">
        {conversations.map(conversation => {
          const isActive = conversation.id === activeConversationId;
          const isEditing = editingId === conversation.id;
          const isHovered = hoveredId === conversation.id;

          return (
            <div
              key={conversation.id}
              className={cn(
                'group relative inline-flex items-center px-4 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onMouseEnter={() => setHoveredId(conversation.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {/* Active indicator (bottom border) */}
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}

              {/* Title or edit input */}
              {isEditing ? (
                <input
                  type="text"
                  value={editingTitle}
                  onChange={e => setEditingTitle(e.target.value)}
                  onBlur={() => handleRenameSubmit(conversation.id)}
                  onKeyDown={e => handleRenameKeyDown(e, conversation.id)}
                  className="h-6 w-32 rounded border border-border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  autoFocus
                  onFocus={e => e.target.select()}
                />
              ) : (
                <div className="relative flex items-center justify-center min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => onSelectConversation(conversation.id)}
                    onDoubleClick={() => handleDoubleClick(conversation)}
                    className="truncate text-left"
                  >
                    {conversation.title}
                  </button>
                </div>
              )}

              {/* Gradient fade on hover */}
              {!isEditing && isHovered && conversations.length > 1 && (
                <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent pointer-events-none" />
              )}

              {/* Close button (show only on hover) - positioned absolutely relative to tab */}
              {!isEditing && isHovered && conversations.length > 1 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onDeleteConversation(conversation.id);
                      }}
                      className="absolute right-2 inline-flex h-5 w-5 items-center justify-center rounded bg-muted/80 transition-colors hover:bg-muted hover:text-foreground"
                      aria-label="Delete conversation"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={2}>
                    Delete conversation
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          );
        })}

        {/* New conversation button with provider selector */}
        <NewConversationButton
          workspaceId={workspaceId}
          onProviderSelect={onCreateConversationWithProvider}
          isBusy={isBusy}
        />
      </div>
      </div>
    </TooltipProvider>
  );
};
