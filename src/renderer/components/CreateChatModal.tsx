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
import { AgentDropdown } from './AgentDropdown';
import { agentConfig } from '../lib/agentConfig';
import { isValidProviderId } from '@shared/providers/registry';
import type { Agent } from '../types';
import type { Conversation } from '../../main/services/DatabaseService';

const DEFAULT_AGENT: Agent = 'claude';

interface CreateChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateChat: (title: string, agent: string) => void;
  existingConversations?: Conversation[];
}

export function CreateChatModal({
  isOpen,
  onClose,
  onCreateChat,
  existingConversations = [],
}: CreateChatModalProps) {
  const [selectedAgent, setSelectedAgent] = useState<Agent>(DEFAULT_AGENT);
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

  // Find first available agent in agentConfig order
  const findFirstAvailableAgent = (usedSet: Set<string>): Agent | null => {
    for (const key of Object.keys(agentConfig)) {
      if (!usedSet.has(key)) {
        return key as Agent;
      }
    }
    return null;
  };

  // Load default agent from settings and reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setError(null);

      let cancel = false;
      window.electronAPI.getSettings().then((res) => {
        if (cancel) return;

        const settings = res?.success ? res.settings : undefined;
        const settingsAgent = settings?.defaultProvider;
        const defaultFromSettings: Agent = isValidProviderId(settingsAgent)
          ? (settingsAgent as Agent)
          : DEFAULT_AGENT;

        // Priority: settings default (if available) > first available in agentConfig order
        if (!usedAgents.has(defaultFromSettings)) {
          setSelectedAgent(defaultFromSettings);
          setError(null);
        } else {
          const firstAvailable = findFirstAvailableAgent(usedAgents);
          if (firstAvailable) {
            setSelectedAgent(firstAvailable);
            setError(null);
          } else {
            setError('All agents are already in use for this task');
          }
        }
      });

      return () => {
        cancel = true;
      };
    }
  }, [isOpen, usedAgents]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (usedAgents.has(selectedAgent)) {
      setError('Please select an available agent');
      return;
    }

    setIsCreating(true);
    try {
      const chatTitle = `Chat ${Date.now()}`;
      onCreateChat(chatTitle, selectedAgent);
      onClose();
      setError(null);
    } catch (err) {
      console.error('Failed to create chat:', err);
      setError('Failed to create chat');
    } finally {
      setIsCreating(false);
    }
  };

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
            <Label className="shrink-0">Agent</Label>
            <AgentDropdown
              value={selectedAgent}
              onChange={setSelectedAgent}
              disabledAgents={Array.from(usedAgents)}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={!!error || isCreating}>
              {isCreating ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
