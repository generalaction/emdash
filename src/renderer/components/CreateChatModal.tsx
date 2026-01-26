import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Separator } from './ui/separator';
import { MultiAgentDropdown } from './MultiAgentDropdown';
import type { Agent } from '../types';
import type { AgentRun } from '../types/chat';
import type { Conversation } from '../../main/services/DatabaseService';

interface CreateChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateChat: (title: string, agent: string) => void;
  installedProviders: string[];
  currentProvider?: string;
  existingConversations?: Conversation[];
}

export function CreateChatModal({
  isOpen,
  onClose,
  onCreateChat,
  installedProviders,
  currentProvider,
  existingConversations = [],
}: CreateChatModalProps) {
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([
    { agent: (currentProvider || 'claude') as Agent, runs: 1 },
  ]);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Extract agents that are already in use
  const usedAgents = useMemo(() => {
    const agents = new Set<string>();
    existingConversations.forEach((conv) => {
      if (conv.provider) {
        agents.add(conv.provider);
      }
    });
    return agents;
  }, [existingConversations]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setError(null);

      // Find first available agent (installed but not already used)
      const availableAgents = installedProviders.filter((p) => !usedAgents.has(p));

      if (availableAgents.length > 0) {
        // Prefer current agent if it's available, otherwise use first available
        const defaultAgent = availableAgents.includes(currentProvider || '')
          ? currentProvider
          : availableAgents[0];
        setAgentRuns([{ agent: defaultAgent as Agent, runs: 1 }]);
      } else {
        // All agents are in use - this shouldn't normally happen but handle gracefully
        setAgentRuns([]);
        setError('All installed agents are already in use for this task');
      }
    }
  }, [isOpen, currentProvider, installedProviders, usedAgents]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (agentRuns.length === 0) {
      setError('Please select an agent');
      return;
    }

    setIsCreating(true);
    try {
      // For multi-chat, we only use single agent
      const agent = agentRuns[0].agent;
      // Simple title for internal use (not displayed in UI)
      const chatTitle = `Chat ${Date.now()}`;
      onCreateChat(chatTitle, agent);
      onClose();

      // Reset state
      setError(null);
    } catch (error) {
      console.error('Failed to create chat:', error);
      setError('Failed to create chat');
    } finally {
      setIsCreating(false);
    }
  };

  // Filter available agents to only installed and not already used
  const defaultAgent = useMemo(() => {
    const availableAgents = installedProviders.filter((p) => !usedAgents.has(p));
    if (currentProvider && availableAgents.includes(currentProvider)) {
      return currentProvider as Agent;
    }
    return (availableAgents[0] || 'claude') as Agent;
  }, [currentProvider, installedProviders, usedAgents]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isCreating && onClose()}>
      <DialogContent className="max-h-[calc(100vh-48px)] max-w-md overflow-visible">
        <DialogHeader>
          <DialogTitle>New Chat</DialogTitle>
          <DialogDescription className="text-xs">
            Start a new conversation with a different AI agent
          </DialogDescription>
        </DialogHeader>

        <Separator />

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center gap-4">
            <Label className="shrink-0">Select AI Agent</Label>
            <MultiAgentDropdown
              agentRuns={agentRuns}
              onChange={setAgentRuns}
              defaultAgent={defaultAgent}
              disabledAgents={Array.from(usedAgents)}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={!!error || isCreating}>
              {isCreating ? 'Creating...' : 'Create Chat'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
