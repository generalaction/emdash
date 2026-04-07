import React, { useEffect, useMemo, useState } from 'react';
import { AgentSelector } from './AgentSelector';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Switch } from './ui/switch';
import { Textarea } from './ui/textarea';
import type { Agent } from '../types';
import { isValidProviderId } from '@shared/providers/registry';
import {
  DEFAULT_REVIEW_AGENT,
  DEFAULT_REVIEW_PROMPT,
  type ReviewSettings,
} from '@shared/reviewPreset';
import { useAppSettings } from '@/contexts/AppSettingsProvider';

const DEFAULT_REVIEW_SETTINGS: ReviewSettings = {
  enabled: false,
  agent: DEFAULT_REVIEW_AGENT,
  prompt: DEFAULT_REVIEW_PROMPT,
};

const ReviewAgentSettingsCard: React.FC = () => {
  const { settings, updateSettings, isLoading: loading, isSaving: saving } = useAppSettings();

  const reviewSettings = useMemo<ReviewSettings>(() => {
    const configured = settings?.review;
    return {
      enabled: configured?.enabled ?? DEFAULT_REVIEW_SETTINGS.enabled,
      agent: isValidProviderId(configured?.agent)
        ? configured.agent
        : DEFAULT_REVIEW_SETTINGS.agent,
      prompt:
        typeof configured?.prompt === 'string' && configured.prompt.trim()
          ? configured.prompt
          : DEFAULT_REVIEW_SETTINGS.prompt,
    };
  }, [settings?.review]);

  const [promptDraft, setPromptDraft] = useState(reviewSettings.prompt);

  useEffect(() => {
    setPromptDraft(reviewSettings.prompt);
  }, [reviewSettings.prompt]);

  const handlePromptBlur = () => {
    const nextPrompt = promptDraft.trim() || DEFAULT_REVIEW_PROMPT;
    if (nextPrompt === reviewSettings.prompt) {
      if (promptDraft !== reviewSettings.prompt) {
        setPromptDraft(reviewSettings.prompt);
      }
      return;
    }
    updateSettings({ review: { prompt: nextPrompt } });
  };

  return (
    <div
      id="review-agent-settings-card"
      className="flex flex-col gap-4 rounded-xl border border-muted p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-1 flex-col gap-0.5">
          <p className="text-sm font-medium text-foreground">Review preset</p>
          <p className="text-sm text-muted-foreground">
            Adds a dedicated review action in task chats and the changes panel.
          </p>
        </div>
        <Switch
          checked={reviewSettings.enabled}
          disabled={loading || saving}
          onCheckedChange={(enabled) => updateSettings({ review: { enabled } })}
          aria-label="Enable review preset"
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-1 flex-col gap-0.5">
          <Label htmlFor="review-agent" className="text-sm font-medium text-foreground">
            Review agent
          </Label>
          <p className="text-sm text-muted-foreground">
            Used when you launch a review chat from the task UI.
          </p>
        </div>
        <div id="review-agent" className="w-[183px] flex-shrink-0">
          <AgentSelector
            value={reviewSettings.agent as Agent}
            onChange={(agent) => updateSettings({ review: { agent } })}
            disabled={loading || saving}
            className="w-full"
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="review-prompt" className="text-sm font-medium text-foreground">
            Review prompt
          </Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={loading || saving}
            onClick={() => {
              setPromptDraft(DEFAULT_REVIEW_PROMPT);
              updateSettings({ review: { prompt: DEFAULT_REVIEW_PROMPT } });
            }}
          >
            Reset
          </Button>
        </div>
        <Textarea
          id="review-prompt"
          value={promptDraft}
          disabled={loading || saving}
          onChange={(event) => setPromptDraft(event.target.value)}
          onBlur={handlePromptBlur}
          rows={5}
          className="min-h-[120px] resize-y"
        />
        <p className="text-xs text-muted-foreground">
          This prompt is sent only for the review preset. Regular extra chat tabs stay unchanged.
        </p>
      </div>
    </div>
  );
};

export default ReviewAgentSettingsCard;
