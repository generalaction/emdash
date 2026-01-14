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
import { SlugInput } from './ui/slug-input';
import { Label } from './ui/label';
import { Separator } from './ui/separator';
import { MultiProviderDropdown } from './MultiProviderDropdown';
import { providerConfig } from '../lib/providerConfig';
import type { Provider } from '../types';
import type { ProviderRun } from '../types/chat';

interface CreateChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateChat: (title: string, provider: string) => void;
  installedProviders: string[];
  currentProvider?: string;
  taskName?: string;
}

export function CreateChatModal({
  isOpen,
  onClose,
  onCreateChat,
  installedProviders,
  currentProvider,
  taskName = 'Task',
}: CreateChatModalProps) {
  const [chatName, setChatName] = useState('');
  const [providerRuns, setProviderRuns] = useState<ProviderRun[]>([
    { provider: (currentProvider || 'claude') as Provider, runs: 1 },
  ]);
  const [isCreating, setIsCreating] = useState(false);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      // Generate a simple default name
      const date = new Date()
        .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        .toLowerCase()
        .replace(' ', '-');
      setChatName(`chat-${date}`);
      setTouched(false);
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

  const validate = (name: string): string | null => {
    if (!name.trim()) {
      return 'Chat name is required';
    }
    if (name.length < 2) {
      return 'Chat name must be at least 2 characters';
    }
    return null;
  };

  const handleNameChange = (value: string) => {
    setChatName(value);
    if (touched) {
      setError(validate(value));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);

    const err = validate(chatName);
    if (err) {
      setError(err);
      return;
    }

    if (providerRuns.length === 0) {
      setError('Please select a provider');
      return;
    }

    setIsCreating(true);
    try {
      // For multi-chat, we only use single provider
      const provider = providerRuns[0].provider;
      onCreateChat(chatName, provider);
      onClose();

      // Reset state
      setChatName('');
      setTouched(false);
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
            {taskName} • Create a new conversation
          </DialogDescription>
        </DialogHeader>

        <Separator />

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="chat-name" className="mb-2 block">
              Chat name
            </Label>
            <SlugInput
              id="chat-name"
              value={chatName}
              onChange={handleNameChange}
              onBlur={() => setTouched(true)}
              placeholder="bug-fix-auth"
              maxLength={64}
              className={`w-full ${touched && error ? 'border-destructive focus-visible:border-destructive focus-visible:ring-destructive' : ''}`}
              aria-invalid={touched && !!error}
              autoFocus
            />
            {touched && error && <p className="mt-1 text-xs text-destructive">{error}</p>}
          </div>

          <div className="flex items-center gap-4">
            <Label className="shrink-0">AI Provider</Label>
            <MultiProviderDropdown
              providerRuns={providerRuns}
              onChange={setProviderRuns}
              defaultProvider={defaultProvider}
            />
          </div>

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
