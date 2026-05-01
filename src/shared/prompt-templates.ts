export interface PromptTemplate {
  id: string;
  name: string;
  text: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePromptTemplateInput {
  name: string;
  text: string;
}

export interface UpdatePromptTemplateInput {
  name?: string;
  text?: string;
  sortOrder?: number;
}

export const MAX_PROMPT_TEMPLATES = 20;

export const STARTER_PROMPT_TEMPLATES: ReadonlyArray<CreatePromptTemplateInput> = [
  {
    name: 'Review',
    text: 'Review all changes in this worktree. Focus on correctness, regressions, edge cases, and missing tests. List concrete issues first, then note residual risks.',
  },
  {
    name: 'Summarize',
    text: 'Summarize the changes made in this worktree. Explain what was changed, why it was changed, and any notable implementation details.',
  },
  {
    name: 'Find bugs',
    text: 'Look for bugs, edge cases, and regressions in this worktree. Be thorough and list every issue you find, no matter how small.',
  },
  {
    name: 'Write tests',
    text: 'Write unit tests for the changed files in this worktree. Cover happy paths, edge cases, and error handling.',
  },
];
