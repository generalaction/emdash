import { cn } from '@renderer/utils/utils';

function stripMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/`{3}[\s\S]*?`{3}/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*>\s+/gm, '')
    .replace(/\n+/g, ' ')
    .trim();
}

/**
 * Renders markdown as stripped plain text — no syntax characters, no line breaks.
 * Intended for compact single-line previews like issue descriptions.
 */
export function InlineMarkdown({ content, className }: { content: string; className?: string }) {
  return <div className={cn(className)}>{stripMarkdown(content)}</div>;
}
