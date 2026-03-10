import { useState, useEffect, useCallback } from 'react';
import type { ContentContext } from '@/types/electron-api';
import type { ContentBrief } from '@/components/content/ContentBriefFields';
import { parseContentWorkflow } from '@/lib/contentWorkflowStatus';

export interface ContentContextResult {
  context: ContentContext | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Hook to fetch content context for a task based on its collection.
 * Automatically loads brand and knowledge context when collectionId changes.
 */
export function useContentContext(collectionId: string | null | undefined): ContentContextResult {
  const [context, setContext] = useState<ContentContext | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!collectionId) {
      setContext(null);
      setError(null);
      return;
    }

    let cancelled = false;

    const fetchContext = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await window.electronAPI.contentContextGetForTask({
          collectionId,
        });

        if (!cancelled) {
          if (result.success && result.data) {
            setContext(result.data);
          } else {
            setError(result.error || 'Failed to load content context');
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchContext();

    return () => {
      cancelled = true;
    };
  }, [collectionId]);

  return { context, isLoading, error };
}

/**
 * Get content context from task metadata.
 */
export function getCollectionIdFromTaskMetadata(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  const workflow = parseContentWorkflow(metadata);
  return workflow?.collectionId || null;
}

/**
 * Get content brief from task metadata.
 */
export function getBriefFromTaskMetadata(
  metadata: Record<string, unknown> | null | undefined
): ContentBrief | null {
  const workflow = parseContentWorkflow(metadata);
  return workflow?.brief || null;
}

/**
 * Compose a full prompt with content context for agent injection.
 * This is the main function to call when starting an agent with content context.
 */
export async function composeContentPrompt(options: {
  collectionId: string | null;
  userPrompt?: string;
  role?: string;
  brief?: ContentBrief;
}): Promise<{
  prompt: string;
  context: ContentContext | null;
  error: string | null;
}> {
  const { collectionId, userPrompt, role, brief } = options;

  if (!collectionId) {
    // No content context, just return the user prompt
    return {
      prompt: userPrompt || '',
      context: null,
      error: null,
    };
  }

  try {
    const result = await window.electronAPI.contentContextComposePrompt({
      collectionId,
      userPrompt,
      role,
      includeBrief: !!brief,
      brief,
    });

    if (result.success && result.data) {
      return {
        prompt: result.data.prompt,
        context: result.data.context,
        error: null,
      };
    } else {
      return {
        prompt: userPrompt || '',
        context: null,
        error: result.error || 'Failed to compose prompt',
      };
    }
  } catch (err) {
    return {
      prompt: userPrompt || '',
      context: null,
      error: String(err),
    };
  }
}

/**
 * Hook for composing content-aware prompts.
 * Use this when you need to manually compose a prompt with content context.
 */
export function useContentPromptComposer() {
  const [isComposing, setIsComposing] = useState(false);

  const compose = useCallback(
    async (options: {
      collectionId: string | null;
      userPrompt?: string;
      role?: string;
      brief?: ContentBrief;
    }) => {
      setIsComposing(true);
      try {
        return await composeContentPrompt(options);
      } finally {
        setIsComposing(false);
      }
    },
    []
  );

  return { compose, isComposing };
}

/**
 * Prepend content context to an existing prompt.
 * Use this to enhance an existing prompt with content context.
 */
export async function enhancePromptWithContext(options: {
  collectionId: string | null;
  originalPrompt: string;
  brief?: ContentBrief;
}): Promise<string> {
  const { collectionId, originalPrompt, brief } = options;

  if (!collectionId) {
    return originalPrompt;
  }

  const result = await composeContentPrompt({
    collectionId,
    userPrompt: originalPrompt,
    brief,
  });

  return result.prompt;
}
