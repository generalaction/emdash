import { source } from '@/lib/source';

export const revalidate = false;

export function GET() {
  const pages = source.getPages();
  const lines: string[] = [];

  for (const page of pages) {
    const url = page.url;
    const data = page.data as { title?: string; description?: string };
    const title = data.title ?? 'Page';
    const description = data.description ?? '';
    lines.push(`## ${title}`);
    if (description) {
      lines.push(`> ${description}`);
    }
    lines.push(`- Source: ${url}\n`);
  }

  const result = lines.join('\n');
  return new Response(result || '# No pages found', {
    headers: {
      'Content-Type': 'text/markdown',
    },
  });
}
