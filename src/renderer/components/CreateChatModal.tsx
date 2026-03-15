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
import { Switch } from './ui/switch';
import { Textarea } from './ui/textarea';
import { agentConfig } from '../lib/agentConfig';
import { isValidProviderId } from '@shared/providers/registry';
import type { Agent } from '../types';
import { rpc } from '@/lib/rpc';
import { useAppSettings } from '@/contexts/AppSettingsProvider';
import { getReviewSettings } from '@/lib/reviewChat';
import { agentMeta } from '@/providers/meta';
import { buildReviewConversationMetadata } from '@shared/reviewPreset';

const DEFAULT_AGENT: Agent = 'claude';

interface CreateChatRequest {
  title: string;
  agent: string;
  metadata?: string | null;
}

interface CreateChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateChat: (request: CreateChatRequest) => void;
  installedAgents: string[];
}

export function CreateChatModal({
  isOpen,
  onClose,
  onCreateChat,
  installedAgents,
}: CreateChatModalProps) {
  const { settings } = useAppSettings();
  const [selectedAgent, setSelectedAgent] = useState<Agent>(DEFAULT_AGENT);
  const [reviewEnabled, setReviewEnabled] = useState(false);
  const [reviewAgent, setReviewAgent] = useState<Agent>(DEFAULT_AGENT);
  const [reviewPrompt, setReviewPrompt] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const installedSet = useMemo(() => new Set(installedAgents), [installedAgents]);
  const reviewSettings = useMemo(() => getReviewSettings(settings), [settings]);
  const reviewAgentInstalled = installedSet.has(reviewAgent);
  const reviewSupportsPrompt =
    agentMeta[reviewAgent]?.initialPromptFlag !== undefined ||
    agentMeta[reviewAgent]?.useKeystrokeInjection === true;
  const reviewAvailable =
    reviewSettings.enabled && !!reviewPrompt.trim() && reviewAgentInstalled && reviewSupportsPrompt;

  // Load default agent from settings and reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setError(null);
      setReviewEnabled(false);
      setReviewAgent(reviewSettings.agent as Agent);
      setReviewPrompt(reviewSettings.prompt);

      let cancel = false;
      rpc.appSettings.get().then((settings) => {
        if (cancel) return;

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
  }, [isOpen, installedSet, reviewSettings.agent, reviewSettings.prompt]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (reviewEnabled) {
      if (!reviewSettings.enabled) {
        setError('Review preset is disabled');
        return;
      }
      if (!reviewPrompt.trim()) {
        setError('Review prompt is empty');
        return;
      }
      if (!reviewAgentInstalled) {
        setError('Configured review agent is not installed');
        return;
      }
      if (!reviewSupportsPrompt) {
        setError('Configured review agent does not support automatic prompts');
        return;
      }
    }

    if (!reviewEnabled && !installedSet.has(selectedAgent)) {
      setError('Please select an installed agent');
      return;
    }

    setIsCreating(true);
    try {
      if (reviewEnabled) {
        onCreateChat({
          title: 'Review',
          agent: reviewAgent,
          metadata: buildReviewConversationMetadata(reviewPrompt.trim()),
        });
      } else {
        onCreateChat({
          title: `Chat ${Date.now()}`,
          agent: selectedAgent,
        });
      }
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
          {!reviewEnabled ? (
            <div className="flex items-center gap-4">
              <Label className="shrink-0">Agent</Label>
              <AgentDropdown
                value={selectedAgent}
                onChange={setSelectedAgent}
                installedAgents={installedAgents}
              />
            </div>
          ) : null}

          {reviewSettings.enabled ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <Label className="text-sm font-medium">Review</Label>
                <Switch
                  checked={reviewEnabled}
                  onCheckedChange={(checked) => {
                    setReviewEnabled(checked);
                    setError(null);
                  }}
                  aria-label="Enable review mode"
                />
              </div>

              {reviewEnabled ? (
                <div className="space-y-3 rounded-lg border border-border px-3 py-3">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">Review mode</Label>
                    <p className="text-xs text-muted-foreground">
                      Start a review chat instead of a regular blank chat.
                    </p>
                  </div>

                  <div className="flex items-center gap-4">
                    <Label className="shrink-0">Review agent</Label>
                    <AgentDropdown
                      value={reviewAgent}
                      onChange={setReviewAgent}
                      installedAgents={installedAgents}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="review-prompt" className="text-sm font-medium">
                      Prompt
                    </Label>
                    <Textarea
                      id="review-prompt"
                      value={reviewPrompt}
                      onChange={(event) => setReviewPrompt(event.target.value)}
                      rows={5}
                      className="min-h-[120px] resize-y"
                    />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {error && <p className="text-xs text-destructive">{error}</p>}
          {reviewEnabled && !error && !reviewAvailable ? (
            <p className="text-xs text-muted-foreground">
              Finish configuring the review preset in Settings to enable this option.
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="submit"
              disabled={!!error || isCreating || (reviewEnabled && !reviewAvailable)}
            >
              {isCreating ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
