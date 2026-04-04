import React, { useState } from 'react';
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { AgentDropdown } from './AgentDropdown';
import { BaseModalProps, useModalContext } from '@/contexts/ModalProvider';
import type { Agent } from '../types';
import { agentConfig } from '../lib/agentConfig';
import type { AIReviewConfig, ReviewDepth, ReviewType, AIReviewResult } from '@shared/reviewPreset';
import { REVIEW_DEPTH_AGENTS } from '@shared/reviewPreset';
import { launchReviewAgents, pollReviewMessages, aggregateReviewResults } from '@/lib/aiReview';
import { useToast } from '@/hooks/use-toast';

interface AIReviewConfigModalProps {
  taskId: string;
  taskPath: string;
  availableAgents?: Agent[];
  installedAgents: string[];
}

export type AIReviewConfigModalOverlayProps = BaseModalProps<AIReviewConfig> &
  AIReviewConfigModalProps;

export function AIReviewConfigModalOverlay({
  taskId,
  taskPath,
  availableAgents = [],
  installedAgents,
  onSuccess,
  onClose,
}: AIReviewConfigModalOverlayProps) {
  const [depth, setDepth] = useState<ReviewDepth>('quick');
  const [providerId, setProviderId] = useState<Agent>('claude');
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { toast } = useToast();

  const { showModal } = useModalContext();

  // If no installed agents provided, use all agents from agentConfig
  const effectiveInstalledAgents =
    installedAgents.length > 0 ? installedAgents : Object.keys(agentConfig);
  const effectiveAvailableAgents =
    availableAgents.length > 0 ? availableAgents : Object.keys(agentConfig);

  const handleStartReview = async () => {
    if (!providerId) {
      setError('Please select a provider');
      return;
    }

    setIsStarting(true);
    setError(null);

    const config: AIReviewConfig = {
      depth,
      reviewType: 'file-changes',
      providerId: providerId as AIReviewConfig['providerId'],
    };

    try {
      // Launch review agents
      const { reviewId, conversationIds } = await launchReviewAgents(config, taskId, taskPath);

      // Close config modal
      onSuccess(config);

      toast({
        title: 'Review Started',
        description:
          'AI Review is analyzing the requested scope. You will be notified when complete.',
      });

      // Poll for results in background
      pollForResults(reviewId, conversationIds, config, 0);
    } catch (err) {
      console.error('Failed to start review:', err);
      setError(err instanceof Error ? err.message : 'Failed to start review');
      setIsStarting(false);
    }
  };

  async function pollForResults(
    reviewId: string,
    conversationIds: string[],
    config: AIReviewConfig,
    pollCount: number
  ) {
    const maxPolls = 120; // 2 minutes with 1s interval
    const pollInterval = 1000;

    if (pollCount >= maxPolls) {
      // Timeout - show partial results
      try {
        const results = await collectResults(conversationIds, config, reviewId);
        showResultsModal(results);
      } catch {
        // Ignore errors on timeout
      }
      return;
    }

    try {
      // Check if we have any responses from review agents
      let hasResponses = false;
      for (const convId of conversationIds) {
        const { messages } = await pollReviewMessages(convId);
        if (messages.some((m) => m.sender === 'agent' && m.content.length > 50)) {
          hasResponses = true;
          break;
        }
      }

      if (hasResponses) {
        const results = await collectResults(conversationIds, config, reviewId);
        showResultsModal(results);
        return;
      }
    } catch {
      // Continue polling on error
    }

    // Schedule next poll
    setTimeout(() => {
      pollForResults(reviewId, conversationIds, config, pollCount + 1);
    }, pollInterval);
  }

  async function collectResults(
    conversationIds: string[],
    config: AIReviewConfig,
    reviewId: string
  ): Promise<AIReviewResult[]> {
    const results: AIReviewResult[] = [];
    const startTime = Date.now();

    for (const convId of conversationIds) {
      try {
        const { messages } = await pollReviewMessages(convId);
        const durationMs = Date.now() - startTime;
        const issues = messages
          .filter((m) => m.sender === 'agent')
          .flatMap((m) => {
            try {
              const parsed = JSON.parse(m.content);
              if (Array.isArray(parsed)) {
                return parsed;
              }
              if (parsed.issues && Array.isArray(parsed.issues)) {
                return parsed.issues;
              }
            } catch {
              // Not JSON, ignore
            }
            return [];
          });

        if (issues.length > 0 || messages.some((m) => m.sender === 'agent')) {
          const aggregated = await aggregateReviewResults(
            [{ conversationId: convId, messages }],
            config,
            reviewId,
            durationMs
          );
          results.push(aggregated);
        }
      } catch {
        // Ignore errors for individual conversations
      }
    }

    return results;
  }

  function showResultsModal(results: AIReviewResult[]) {
    showModal('aiReviewResultsModal', {
      results,
      isLoading: false,
      onRunAnotherReview: () => {
        showModal('aiReviewConfigModal', {
          taskId,
          taskPath,
          availableAgents,
          installedAgents,
          onSuccess: () => {},
        });
      },
      onClose: () => {},
    });
  }

  const depthLabels: Record<ReviewDepth, { label: string; description: string }> = {
    quick: { label: 'Quick', description: `${REVIEW_DEPTH_AGENTS.quick} agent` },
    focused: { label: 'Focused', description: `${REVIEW_DEPTH_AGENTS.focused} agents` },
    comprehensive: {
      label: 'Comprehensive',
      description: `${REVIEW_DEPTH_AGENTS.comprehensive} agents`,
    },
  };

  return (
    <DialogContent className="max-h-[calc(100vh-48px)] max-w-md overflow-visible">
      <DialogHeader>
        <DialogTitle>AI Review</DialogTitle>
        <DialogDescription className="text-xs">
          Configure review settings. The review will analyze your changes and provide structured
          feedback.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-6 py-4">
        {/* Review Depth */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Review Depth</Label>
          <RadioGroup
            value={depth}
            onValueChange={(v) => setDepth(v as ReviewDepth)}
            className="space-y-2"
          >
            {(Object.keys(depthLabels) as ReviewDepth[]).map((d) => (
              <div key={d} className="flex items-center space-x-3">
                <RadioGroupItem value={d} id={`depth-${d}`} />
                <Label
                  htmlFor={`depth-${d}`}
                  className="flex-1 cursor-pointer flex-col items-start"
                >
                  <span className="text-sm font-medium">{depthLabels[d as ReviewDepth].label}</span>
                  <span className="text-xs text-muted-foreground">
                    {depthLabels[d as ReviewDepth].description}
                  </span>
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        {/* Provider Selection */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Provider</Label>
          <AgentDropdown
            value={providerId}
            onChange={setProviderId}
            installedAgents={effectiveInstalledAgents}
          />
          <p className="text-xs text-muted-foreground">Agent used to perform the review</p>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={isStarting}>
          Cancel
        </Button>
        <Button onClick={handleStartReview} disabled={isStarting}>
          {isStarting ? 'Starting...' : 'Start Review'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
