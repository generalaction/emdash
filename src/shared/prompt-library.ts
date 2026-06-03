import z from 'zod';

export const DEFAULT_REVIEW_PROMPT =
  'Review all changes in this worktree. Focus on correctness, regressions, edge cases, and missing tests. List concrete issues first, then note residual risks.';

export const promptLibraryPromptSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string().min(1),
  folderId: z.string().min(1).optional(),
});

export const promptLibraryFolderSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
});

export const promptLibrarySchema = z.object({
  folders: z.array(promptLibraryFolderSchema),
  prompts: z.array(promptLibraryPromptSchema),
  /** Folder ids the user has collapsed in the library UI. Omitted or empty means all expanded. */
  collapsedFolderIds: z.array(z.string().min(1)).optional(),
});

export type PromptLibraryPrompt = z.infer<typeof promptLibraryPromptSchema>;
export type PromptLibraryFolder = z.infer<typeof promptLibraryFolderSchema>;
export type PromptLibrary = z.infer<typeof promptLibrarySchema>;

export const DEFAULT_PROMPT_LIBRARY: PromptLibrary = {
  folders: [],
  prompts: [
    {
      id: 'review-prompt',
      title: 'Review prompt',
      prompt: DEFAULT_REVIEW_PROMPT,
    },
  ],
};

export const PROMPT_LIBRARY_SEED_VERSION = 1;
