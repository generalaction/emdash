import z from 'zod';

export const DEFAULT_REVIEW_PROMPT =
  'Review all changes in this worktree. Focus on correctness, regressions, edge cases, and missing tests. List concrete issues first, then note residual risks.';

export const promptLibraryPromptSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string().min(1),
  folderId: z.string().min(1).optional(),
});

export const promptLibrarySchema = z.array(promptLibraryPromptSchema);

export const promptLibraryFolderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

export const promptLibraryFoldersSchema = z.array(promptLibraryFolderSchema);

export type PromptLibraryPrompt = z.infer<typeof promptLibraryPromptSchema>;
export type PromptLibraryFolder = z.infer<typeof promptLibraryFolderSchema>;

export type PromptLibraryState = {
  prompts: PromptLibraryPrompt[];
  folders: PromptLibraryFolder[];
};

export const DEFAULT_PROMPT_LIBRARY: PromptLibraryPrompt[] = [
  {
    id: 'review-prompt',
    title: 'Review prompt',
    prompt: DEFAULT_REVIEW_PROMPT,
  },
];

export const PROMPT_LIBRARY_SEED_VERSION = 1;
