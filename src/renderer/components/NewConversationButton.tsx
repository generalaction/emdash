import React, { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { PROVIDER_IDS, type ProviderId } from '@shared/providers/registry';
import { cn } from '../lib/utils';

interface NewConversationButtonProps {
  workspaceId: string;
  onProviderSelect: (provider: ProviderId | null) => void;
  isBusy?: boolean;
  className?: string;
}

export const NewConversationButton: React.FC<NewConversationButtonProps> = ({
  workspaceId,
  onProviderSelect,
  isBusy = false,
  className,
}) => {
  const [defaultProvider, setDefaultProvider] = useState<ProviderId>('claude');

  // Load default provider from localStorage
  useEffect(() => {
    try {
      const lastKey = `provider:last:${workspaceId}`;
      const last = window.localStorage.getItem(lastKey) as ProviderId | null;

      if (last && PROVIDER_IDS.includes(last as any)) {
        setDefaultProvider(last);
      } else {
        setDefaultProvider('claude');
        window.localStorage.setItem(lastKey, 'claude');
      }
    } catch (error) {
      console.error('Failed to load last provider:', error);
      setDefaultProvider('claude');
    }
  }, [workspaceId]);

  const handleClick = () => {
    if (isBusy) return;
    onProviderSelect(defaultProvider);
  };

  return (
    <button
      type="button"
      disabled={isBusy}
      onClick={handleClick}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-md',
        'text-muted-foreground hover:text-foreground hover:bg-accent',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'transition-colors',
        className
      )}
      aria-label="New conversation"
    >
      <Plus className="h-3.5 w-3.5" />
    </button>
  );
};