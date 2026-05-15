import { eq } from 'drizzle-orm';
import {
  DEFAULT_PROMPT_LIBRARY,
  PROMPT_LIBRARY_SEED_VERSION,
  promptLibrarySchema,
  type PromptLibraryPrompt,
} from '@shared/prompt-library';
import { db } from '@main/db/client';
import { KV } from '@main/db/kv';
import { appSettings } from '@main/db/schema';
import type { IInitializable } from '@main/lib/lifecycle';

type PromptLibraryKV = {
  prompts: PromptLibraryPrompt[];
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
      const prompts =
        existingPrompts.length > 0 || !legacyPromptLibrary.success
          ? existingPrompts
          : legacyPromptLibrary.data;
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
    })();

    await this.seedPromise;
  }

  async initialize(): Promise<void> {
    await this.seedIfNeeded();
  }

  async getPrompts(): Promise<PromptLibraryPrompt[]> {
    await this.seedIfNeeded();
    return this.readPrompts();
  }

  async updatePrompts(prompts: PromptLibraryPrompt[]): Promise<void> {
    const validated = promptLibrarySchema.parse(prompts);
    await promptLibraryKV.set('prompts', validated);
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
