import { splitBrowserUrlDisplay } from './browser-url-input';

export function BrowserUrlDisplay({ text }: { text: string }) {
  const parts = splitBrowserUrlDisplay(text);
  if (parts.kind === 'empty') return null;

  if (parts.kind === 'plain') {
    return <span className="truncate text-foreground">{parts.text}</span>;
  }

  return (
    <span className="flex min-w-0 items-center truncate">
      <span className="shrink-0 text-foreground-muted group-hover/url:text-foreground">
        {parts.prefix}
      </span>
      <span className="min-w-0 truncate text-foreground">{parts.remainder}</span>
    </span>
  );
}
