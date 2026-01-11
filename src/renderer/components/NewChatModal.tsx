import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Provider } from '../types';
import ProviderSelector from './ProviderSelector';
import { getProviderInfo } from '../lib/providers';
import { Spinner } from './ui/spinner';

interface NewChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateTab: (providerId: Provider, providerName: string) => void;
  defaultProvider?: Provider;
}

export function NewChatModal({
  isOpen,
  onClose,
  onCreateTab,
  defaultProvider = 'claude',
}: NewChatModalProps) {
  const [selectedProvider, setSelectedProvider] = useState<Provider>(defaultProvider);
  const [isCreating, setIsCreating] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  // Reset to default when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedProvider(defaultProvider);
      setIsCreating(false);
    }
  }, [isOpen, defaultProvider]);

  const handleCreate = async () => {
    if (!selectedProvider || isCreating) return;

    setIsCreating(true);

    // Get provider info
    const providerInfo = getProviderInfo(selectedProvider);
    const providerName = providerInfo?.name || selectedProvider;

    // Small delay for better UX
    await new Promise(resolve => setTimeout(resolve, 100));

    onCreateTab(selectedProvider, providerName);
    onClose();
  };

  const handleCancel = () => {
    if (isCreating) return;
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !isCreating) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence mode="wait">
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2 }}
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
            onClick={handleCancel}
            aria-hidden="true"
          />

          {/* Modal */}
          <div
            className="fixed inset-0 z-[999] flex items-center justify-center p-4"
            onKeyDown={handleKeyDown}
          >
            <motion.div
              initial={shouldReduceMotion ? false : { opacity: 0, y: 8, scale: 0.995 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 6, scale: 0.995 }}
              transition={
                shouldReduceMotion
                  ? { duration: 0 }
                  : { duration: 0.2, ease: [0.22, 1, 0.36, 1] }
              }
              className="w-full max-w-md"
            >
              <Card className="relative border-border/50 bg-background shadow-xl">
                {/* Close button */}
                <button
                  onClick={handleCancel}
                  disabled={isCreating}
                  className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>

                <CardHeader>
                  <CardTitle>New Chat Tab</CardTitle>
                  <CardDescription>
                    Start a new conversation with an AI agent in this workspace.
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label htmlFor="provider-select" className="text-sm font-medium">
                      Select Agent
                    </label>
                    <div id="provider-select">
                      <ProviderSelector
                        value={selectedProvider}
                        onChange={setSelectedProvider}
                        disabled={isCreating}
                      />
                    </div>
                  </div>

                  {/* Spacer to ensure dropdown has room */}
                  <div className="h-48" aria-hidden="true" />
                </CardContent>

                <div className="flex justify-end gap-2 border-t border-border/50 px-6 py-4">
                  <Button
                    variant="outline"
                    onClick={handleCancel}
                    disabled={isCreating}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreate}
                    disabled={!selectedProvider || isCreating}
                  >
                    {isCreating ? (
                      <>
                        <Spinner size="sm" className="mr-2" />
                        Creating...
                      </>
                    ) : (
                      'Create Tab'
                    )}
                  </Button>
                </div>
              </Card>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}