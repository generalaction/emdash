import { source } from '@/lib/source';
import type { InferPageType } from 'fumadocs-core/source';

type Page = InferPageType<typeof source>;

export async function getLLMText(page: Page): Promise<string> {
  const processed = await page.data.getText?.('processed');
  return processed ?? '';
}
