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
import { MultiProviderDropdown } from './MultiProviderDropdown';
import type { Provider } from '../types';
import type { ProviderRun } from '../types/chat';
import type { Conversation } from '../../main/services/DatabaseService';

interface CreateChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateChat: (title: string, provider: string) => void;
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
  const [providerRuns, setProviderRuns] = useState<ProviderRun[]>([
    { provider: (currentProvider || 'claude') as Provider, runs: 1 },
  ]);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Extract providers that are already in use
  const usedProviders = useMemo(() => {
    const providers = new Set<string>();
    existingConversations.forEach((conv) => {
      if (conv.provider) {
        providers.add(conv.provider);
      }
    });
    return providers;
  }, [existingConversations]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setError(null);

      // Find first available provider (installed but not already used)
      const availableProviders = installedProviders.filter((p) => !usedProviders.has(p));

      if (availableProviders.length > 0) {
        // Prefer current provider if it's available, otherwise use first available
        const defaultProvider = availableProviders.includes(currentProvider || '')
          ? currentProvider
          : availableProviders[0];
        setProviderRuns([{ provider: defaultProvider as Provider, runs: 1 }]);
      } else {
        // All providers are in use - this shouldn't normally happen but handle gracefully
        setProviderRuns([]);
        setError('All installed providers are already in use for this task');
      }
    }
  }, [isOpen, currentProvider, installedProviders, usedProviders]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (providerRuns.length === 0) {
      setError('Please select a provider');
      return;
    }

    setIsCreating(true);
    try {
      // For multi-chat, we only use single provider
      const provider = providerRuns[0].provider;
      // Simple title for internal use (not displayed in UI)
      const chatTitle = `Chat ${Date.now()}`;
      onCreateChat(chatTitle, provider);
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

  // Filter available providers to only installed and not already used
  const defaultProvider = useMemo(() => {
    const availableProviders = installedProviders.filter((p) => !usedProviders.has(p));
    if (currentProvider && availableProviders.includes(currentProvider)) {
      return currentProvider as Provider;
    }
    return (availableProviders[0] || 'claude') as Provider;
  }, [currentProvider, installedProviders, usedProviders]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isCreating && onClose()}>
      <DialogContent className="max-h-[calc(100vh-48px)] max-w-md overflow-visible">
        <DialogHeader>
          <DialogTitle>New Chat</DialogTitle>
          <DialogDescription className="text-xs">
            Start a new conversation with a different AI provider
          </DialogDescription>
        </DialogHeader>

        <Separator />

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center gap-4">
            <Label className="shrink-0">Select AI Provider</Label>
            <MultiProviderDropdown
              providerRuns={providerRuns}
              onChange={setProviderRuns}
              defaultProvider={defaultProvider}
              disabledProviders={Array.from(usedProviders)}
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
