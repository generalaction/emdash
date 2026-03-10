/**
 * Content Prompt Enhancer
 *
 * Utilities for enhancing prompts with content context (brand guidelines,
 * knowledge documents, and content briefs) before injecting them into agents.
 */

import type { ContentContext } from '@/types/electron-api';

export interface ContentBrief {
  topic?: string;
  audience?: string;
  keywords?: string;
  tone?: string;
  notes?: string;
}

export interface ContentWorkflowMetadata {
  stage: string;
  collectionId?: string;
  brief?: ContentBrief;
}

/**
 * Check if task metadata has content workflow data.
 */
export function hasContentWorkflow(metadata: Record<string, unknown> | null | undefined): boolean {
  if (!metadata?.contentWorkflow) return false;
  const cw = metadata.contentWorkflow as ContentWorkflowMetadata;
  return !!(cw.collectionId || cw.brief);
}

/**
 * Extract content workflow metadata from task metadata.
 */
export function getContentWorkflowFromMetadata(
  metadata: Record<string, unknown> | null | undefined
): ContentWorkflowMetadata | null {
  if (!metadata?.contentWorkflow) return null;
  return metadata.contentWorkflow as ContentWorkflowMetadata;
}

/**
 * Enhance a prompt with content context.
 * Fetches brand guidelines and knowledge documents from the collection
 * and prepends them to the original prompt.
 *
 * @param originalPrompt - The original user prompt
 * @param collectionId - The collection ID to fetch context from
 * @param brief - Optional content brief to include
 * @param role - Optional role (e.g., "SEO Specialist", "Copywriter")
 * @returns Enhanced prompt with content context prepended
 */
export async function enhancePromptWithContentContext(
  originalPrompt: string,
  collectionId: string | null | undefined,
  brief?: ContentBrief,
  role?: string
): Promise<{ prompt: string; context: ContentContext | null }> {
  if (!collectionId) {
    return { prompt: originalPrompt, context: null };
  }

  try {
    const result = await window.electronAPI.contentContextComposePrompt({
      collectionId,
      userPrompt: originalPrompt,
      role,
      includeBrief: !!brief,
      brief,
    });

    if (result.success && result.data) {
      return {
        prompt: result.data.prompt,
        context: result.data.context,
      };
    }
  } catch (error) {
    console.error('Failed to enhance prompt with content context:', error);
  }

  // Fallback to original prompt if enhancement fails
  return { prompt: originalPrompt, context: null };
}

/**
 * Enhance a prompt based on task metadata.
 * Automatically extracts collection ID and brief from metadata.
 *
 * @param originalPrompt - The original user prompt
 * @param metadata - Task metadata containing contentWorkflow
 * @param role - Optional role for the agent
 * @returns Enhanced prompt with content context
 */
export async function enhancePromptFromTaskMetadata(
  originalPrompt: string,
  metadata: Record<string, unknown> | null | undefined,
  role?: string
): Promise<{ prompt: string; context: ContentContext | null }> {
  const workflow = getContentWorkflowFromMetadata(metadata);

  if (!workflow || !workflow.collectionId) {
    return { prompt: originalPrompt, context: null };
  }

  return enhancePromptWithContentContext(
    originalPrompt,
    workflow.collectionId,
    workflow.brief,
    role
  );
}

/**
 * Get just the content context without composing a prompt.
 * Useful when you need the context for display or other purposes.
 */
export async function getContentContextForTask(
  collectionId: string | null | undefined,
  brief?: ContentBrief
): Promise<ContentContext | null> {
  if (!collectionId) {
    return null;
  }

  try {
    const result = await window.electronAPI.contentContextGetForTask({
      collectionId,
      includeBrief: !!brief,
      brief,
    });

    if (result.success && result.data) {
      return result.data;
    }
  } catch (error) {
    console.error('Failed to get content context:', error);
  }

  return null;
}

/**
 * Format content context info for display (e.g., in UI badges).
 */
export function formatContentContextSummary(context: ContentContext | null): string {
  if (!context) return '';

  const parts: string[] = [];
  if (context.hasBrand) {
    parts.push('Brand');
  }
  if (context.hasKnowledge) {
    parts.push(`${context.documentCount} doc${context.documentCount !== 1 ? 's' : ''}`);
  }

  return parts.join(' + ') || '';
}
