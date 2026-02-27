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

const DEFAULT_AGENT: Agent = 'claude';

interface CreateChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateChat: (title: string, agent: string) => void;
  installedAgents: string[];
}

export function CreateChatModal({
  isOpen,
  onClose,
  onCreateChat,
  installedAgents,
}: CreateChatModalProps) {
  const [selectedAgent, setSelectedAgent] = useState<Agent>(DEFAULT_AGENT);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const installedSet = useMemo(() => new Set(installedAgents), [installedAgents]);

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

        // Priority: settings default (if installed) > first installed in agentConfig order
        if (installedSet.has(defaultFromSettings)) {
          setSelectedAgent(defaultFromSettings);
          setError(null);
        } else {
          const firstInstalled = Object.keys(agentConfig).find((key) => installedSet.has(key)) as
            | Agent
            | undefined;
          if (firstInstalled) {
            setSelectedAgent(firstInstalled);
            setError(null);
          } else {
            setError('No agents installed');
          }
        }
      });

      return () => {
        cancel = true;
      };
    }
  }, [isOpen, installedSet]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!installedSet.has(selectedAgent)) {
      setError('Please select an installed agent');
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
          <DialogTitle>Add Agent to Task</DialogTitle>
          <DialogDescription className="text-xs">
            Add another agent to this chat. It will share the same worktree and appear as a new tab
            alongside your existing chats.
          </DialogDescription>
        </DialogHeader>

        <Separator />

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center gap-4">
            <Label className="shrink-0">Agent</Label>
            <AgentDropdown
              value={selectedAgent}
              onChange={setSelectedAgent}
              installedAgents={installedAgents}
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
