import React from 'react';
import { Label } from './ui/label';
import { Switch } from './ui/switch';
import { Textarea } from './ui/textarea';
import { AgentDropdown } from './AgentDropdown';
import type { Agent } from '../types';

interface CreateChatReviewSectionProps {
  reviewEnabled: boolean;
  onReviewEnabledChange: (enabled: boolean) => void;
  reviewAgent: Agent;
  onReviewAgentChange: (agent: Agent) => void;
  reviewPrompt: string;
  onReviewPromptChange: (prompt: string) => void;
  installedAgents: string[];
}

export function CreateChatReviewSection({
  reviewEnabled,
  onReviewEnabledChange,
  reviewAgent,
  onReviewAgentChange,
  reviewPrompt,
  onReviewPromptChange,
  installedAgents,
}: CreateChatReviewSectionProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <Label className="text-sm font-medium">Review</Label>
        <Switch
          checked={reviewEnabled}
          onCheckedChange={onReviewEnabledChange}
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
              onChange={onReviewAgentChange}
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
              onChange={(event) => onReviewPromptChange(event.target.value)}
              rows={5}
              className="min-h-[120px] resize-y"
            />
          </div>

          <p className="text-[11px] text-muted-foreground/80">
            You can also edit these defaults in Settings.
          </p>
        </div>
      ) : null}
    </div>
  );
}
