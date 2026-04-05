import { isValidProviderId } from '@shared/providers/registry';
import {
  DEFAULT_REVIEW_AGENT,
  DEFAULT_REVIEW_PROMPT,
  buildReviewConversationMetadata,
  type ReviewSettings,
} from '@shared/reviewPreset';
import type { AppSettings } from 'src/main/settings';
import type { Agent } from '../types';
import { rpc } from './rpc';
import { agentMeta } from '@/providers/meta';

const CONVERSATIONS_CHANGED_EVENT = 'emdash:conversations-changed';

export function getReviewSettings(settings?: AppSettings): ReviewSettings {
  const configured = settings?.review;
  return {
    enabled: configured?.enabled ?? false,
    agent: isValidProviderId(configured?.agent) ? configured.agent : DEFAULT_REVIEW_AGENT,
    prompt:
      typeof configured?.prompt === 'string' && configured.prompt.trim()
        ? configured.prompt.trim()
        : DEFAULT_REVIEW_PROMPT,
  };
}

async function assertProviderInstalled(providerId: string): Promise<void> {
  const result = await window.electronAPI.getProviderStatuses?.();
  if (!result?.success || !result.statuses) {
    throw new Error('Failed to get provider statuses');
  }
  if (result.statuses[providerId]?.installed === true) return;
  throw new Error('Configured review agent is not installed');
}

export async function createReviewConversation(args: {
  taskId: string;
  settings?: AppSettings;
}): Promise<{ agent: Agent; conversationId: string }> {
  const review = getReviewSettings(args.settings);

  if (!review.enabled) {
    throw new Error('Review preset is disabled');
  }

  const prompt = review.prompt.trim();
  if (!prompt) {
    throw new Error('Review prompt is empty');
  }
  if (
    agentMeta[review.agent as Agent]?.initialPromptFlag === undefined &&
    agentMeta[review.agent as Agent]?.useKeystrokeInjection !== true
  ) {
    throw new Error('Configured review agent does not support automatic prompts');
  }

  await assertProviderInstalled(review.agent);

  const conversation = await rpc.db.createConversation({
    taskId: args.taskId,
    title: 'Review',
    provider: review.agent,
    isMain: false,
    metadata: buildReviewConversationMetadata(prompt),
  });

  if (!conversation || !conversation.id) {
    throw new Error('Failed to create review conversation');
  }

  window.dispatchEvent(
    new CustomEvent(CONVERSATIONS_CHANGED_EVENT, {
      detail: { taskId: args.taskId, conversationId: conversation.id },
    })
  );

  return { agent: review.agent as Agent, conversationId: conversation.id };
}
