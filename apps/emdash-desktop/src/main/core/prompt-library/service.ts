import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { KV } from '@main/db/kv';
import { appSettings } from '@main/db/schema';
import type { IInitializable } from '@main/lib/lifecycle';
import {
  DEFAULT_PROMPT_LIBRARY,
  PROMPT_LIBRARY_SEED_VERSION,
  promptLibraryFoldersSchema,
  promptLibrarySchema,
  type PromptLibraryFolder,
  type PromptLibraryPrompt,
  type PromptLibraryState,
} from '@shared/prompt-library';

type PromptLibraryKV = {
  prompts: PromptLibraryPrompt[];
  folders: PromptLibraryFolder[];
  seedVersion: number;
};

const promptLibraryKV = new KV<PromptLibraryKV>('prompt-library');

export class PromptLibraryService implements IInitializable {
  private seedPromise: Promise<void> | null = null;

  private async readPrompts(): Promise<PromptLibraryPrompt[]> {
    const prompts = await promptLibraryKV.get('prompts');
    const parsed = promptLibrarySchema.safeParse(prompts ?? []);
    return parsed.success ? parsed.data : [];
  }

  private async readFolders(): Promise<PromptLibraryFolder[]> {
    const folders = await promptLibraryKV.get('folders');
    const parsed = promptLibraryFoldersSchema.safeParse(folders ?? []);
    return parsed.success ? parsed.data : [];
  }

  // Prompts pointing at a deleted/unknown folder fall back to ungrouped instead
  // of disappearing from the grouped UI.
  private sanitizePrompts(
    prompts: PromptLibraryPrompt[],
    folders: PromptLibraryFolder[]
  ): PromptLibraryPrompt[] {
    const folderIds = new Set(folders.map((folder) => folder.id));
    return prompts.map((prompt) => {
      if (!prompt.folderId || folderIds.has(prompt.folderId)) return prompt;
      const { folderId: _folderId, ...rest } = prompt;
      return rest;
    });
  }

  private async readLegacyAppSetting(key: string): Promise<unknown | null> {
    const rows = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, key))
      .limit(1);
    const raw = rows[0]?.value;
    if (!raw) return null;

    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  private async deleteLegacyPromptSettings(): Promise<void> {
    await db.delete(appSettings).where(eq(appSettings.key, 'promptLibrary'));
    await db.delete(appSettings).where(eq(appSettings.key, 'promptLibrarySeedVersion'));
    await db.delete(appSettings).where(eq(appSettings.key, 'reviewPrompt'));
  }

  private async seedIfNeeded(): Promise<void> {
    if (this.seedPromise) return this.seedPromise;

    this.seedPromise = (async () => {
      const seedVersion = await promptLibraryKV.get('seedVersion');
      if ((seedVersion ?? 0) >= PROMPT_LIBRARY_SEED_VERSION) {
        await this.deleteLegacyPromptSettings();
        return;
      }

      const existingPrompts = await this.readPrompts();
      const legacyPromptLibrary = promptLibrarySchema.safeParse(
        await this.readLegacyAppSetting('promptLibrary')
      );
      const legacyReviewPrompt = await this.readLegacyAppSetting('reviewPrompt');
      const prompts = [...existingPrompts];
      if (legacyPromptLibrary.success) {
        for (const legacyPrompt of legacyPromptLibrary.data) {
          if (!prompts.some((prompt) => prompt.id === legacyPrompt.id)) {
            prompts.push(legacyPrompt);
          }
        }
      }
      const defaultPrompts = DEFAULT_PROMPT_LIBRARY.map((prompt) =>
        prompt.id === 'review-prompt' && typeof legacyReviewPrompt === 'string'
          ? { ...prompt, prompt: legacyReviewPrompt }
          : prompt
      );
      const missingSeedPrompts = defaultPrompts.filter(
        (seedPrompt) => !prompts.some((prompt) => prompt.id === seedPrompt.id)
      );
      const nextPrompts = [...missingSeedPrompts, ...prompts];

      if (nextPrompts.length > 0) {
        await promptLibraryKV.set('prompts', nextPrompts);
      }
      await promptLibraryKV.set('seedVersion', PROMPT_LIBRARY_SEED_VERSION);
      await this.deleteLegacyPromptSettings();
    })().finally(() => {
      this.seedPromise = null;
    });

    await this.seedPromise;
  }

  async initialize(): Promise<void> {
    await this.seedIfNeeded();
  }

  async getState(): Promise<PromptLibraryState> {
    await this.seedIfNeeded();
    const [prompts, folders] = await Promise.all([this.readPrompts(), this.readFolders()]);
    return { prompts: this.sanitizePrompts(prompts, folders), folders };
  }

  async updateState(state: PromptLibraryState): Promise<void> {
    const prompts = promptLibrarySchema.parse(state.prompts);
    const folders = promptLibraryFoldersSchema.parse(state.folders);
    await promptLibraryKV.set('prompts', this.sanitizePrompts(prompts, folders));
    await promptLibraryKV.set('folders', folders);
  }

  async upsertReviewPrompt(prompt: string): Promise<void> {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return;

    await this.seedIfNeeded();
    const prompts = await this.readPrompts();
    const reviewPrompt = {
      id: 'review-prompt',
      title: 'Review prompt',
      prompt: trimmedPrompt,
    };
    const exists = prompts.some((item) => item.id === reviewPrompt.id);
    const nextPrompts = exists
      ? prompts.map((item) => (item.id === reviewPrompt.id ? reviewPrompt : item))
      : [reviewPrompt, ...prompts];

    await promptLibraryKV.set('prompts', nextPrompts);
  }
}

export const promptLibraryService = new PromptLibraryService();
