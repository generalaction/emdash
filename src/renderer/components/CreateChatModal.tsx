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

interface CreateChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateChat: (title: string, provider: string) => void;
  installedProviders: string[];
  currentProvider?: string;
}

export function CreateChatModal({
  isOpen,
  onClose,
  onCreateChat,
  installedProviders,
  currentProvider,
}: CreateChatModalProps) {
  const [providerRuns, setProviderRuns] = useState<ProviderRun[]>([
    { provider: (currentProvider || 'claude') as Provider, runs: 1 },
  ]);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setError(null);

      // Set default provider
      if (currentProvider && installedProviders.includes(currentProvider)) {
        setProviderRuns([{ provider: currentProvider as Provider, runs: 1 }]);
      } else if (installedProviders.length > 0) {
        const firstInstalled = installedProviders[0];
        setProviderRuns([{ provider: firstInstalled as Provider, runs: 1 }]);
      }
    }
  }, [isOpen, currentProvider, installedProviders]);

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
      // Generate a simple auto-incremented title
      const timestamp = Date.now();
      const chatTitle = `Chat ${timestamp}`;
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

  // Filter available providers to only installed ones
  const defaultProvider = useMemo(() => {
    if (currentProvider && installedProviders.includes(currentProvider)) {
      return currentProvider as Provider;
    }
    return (installedProviders[0] || 'claude') as Provider;
  }, [currentProvider, installedProviders]);

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
