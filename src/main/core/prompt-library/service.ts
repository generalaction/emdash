import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { KV } from '@main/db/kv';
import { appSettings } from '@main/db/schema';
import type { IInitializable } from '@main/lib/lifecycle';
import {
  DEFAULT_PROMPT_LIBRARY,
  PROMPT_LIBRARY_SEED_VERSION,
  promptLibraryPromptSchema,
  promptLibrarySchema,
  type PromptLibrary,
} from '@shared/prompt-library';

type PromptLibraryKV = {
  prompts: PromptLibrary;
  seedVersion: number;
};

const promptLibraryKV = new KV<PromptLibraryKV>('prompt-library');

export class PromptLibraryService implements IInitializable {
  private seedPromise: Promise<void> | null = null;

  private parseLibrary(value: unknown): PromptLibrary {
    const parsed = promptLibrarySchema.safeParse(value);
    if (parsed.success) return parsed.data;

    const legacyPrompts = promptLibraryPromptSchema.array().safeParse(value);
    if (legacyPrompts.success) {
      return {
        folders: [],
        prompts: legacyPrompts.data,
      };
    }

    return { folders: [], prompts: [] };
  }

  private async readLibrary(): Promise<PromptLibrary> {
    return this.parseLibrary(await promptLibraryKV.get('prompts'));
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

      const existingLibrary = await this.readLibrary();
      const legacyPromptLibrary = promptLibraryPromptSchema
        .array()
        .safeParse(await this.readLegacyAppSetting('promptLibrary'));
      const legacyReviewPrompt = await this.readLegacyAppSetting('reviewPrompt');
      const prompts = [...existingLibrary.prompts];
      if (legacyPromptLibrary.success) {
        for (const legacyPrompt of legacyPromptLibrary.data) {
          if (!prompts.some((prompt) => prompt.id === legacyPrompt.id)) {
            prompts.push(legacyPrompt);
          }
        }
      }
      const defaultPrompts = DEFAULT_PROMPT_LIBRARY.prompts.map((prompt) =>
        prompt.id === 'review-prompt' && typeof legacyReviewPrompt === 'string'
          ? { ...prompt, prompt: legacyReviewPrompt }
          : prompt
      );
      const missingSeedPrompts = defaultPrompts.filter(
        (seedPrompt) => !prompts.some((prompt) => prompt.id === seedPrompt.id)
      );
      const nextLibrary = {
        folders: existingLibrary.folders,
        prompts: [...missingSeedPrompts, ...prompts],
      };

      if (nextLibrary.folders.length > 0 || nextLibrary.prompts.length > 0) {
        await promptLibraryKV.set('prompts', nextLibrary);
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

  async getLibrary(): Promise<PromptLibrary> {
    await this.seedIfNeeded();
    return this.readLibrary();
  }

  async updateLibrary(library: PromptLibrary): Promise<void> {
    const validated = promptLibrarySchema.parse(library);
    await promptLibraryKV.set('prompts', validated);
  }

  async upsertReviewPrompt(prompt: string): Promise<void> {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return;

    await this.seedIfNeeded();
    const library = await this.readLibrary();
    const reviewPrompt = {
      id: 'review-prompt',
      title: 'Review prompt',
      prompt: trimmedPrompt,
    };
    const exists = library.prompts.some((item) => item.id === reviewPrompt.id);
    const nextPrompts = exists
      ? library.prompts.map((item) => (item.id === reviewPrompt.id ? reviewPrompt : item))
      : [reviewPrompt, ...library.prompts];

    await promptLibraryKV.set('prompts', { ...library, prompts: nextPrompts });
  }
}

export const promptLibraryService = new PromptLibraryService();
