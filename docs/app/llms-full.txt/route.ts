import { source } from '@/lib/source';
import { getLLMText } from '@/lib/get-llm-text';

export const revalidate = false;

export async function GET() {
  const pages = source.getPages();
  const scanned = await Promise.all(pages.map(getLLMText));
  return new Response(scanned.join('\n\n'), {
    headers: {
      'Content-Type': 'text/markdown',
    },
  });
}
