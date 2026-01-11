'use client';

import * as React from 'react';

export function CopyMarkdownButton({ markdownUrl }: { markdownUrl: string }) {
  const [state, setState] = React.useState<'idle' | 'copied' | 'error'>('idle');

  async function onCopy() {
    try {
      setState('idle');
      const res = await fetch(markdownUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to fetch markdown: ${res.status}`);
      const md = await res.text();
      await navigator.clipboard.writeText(md);
      setState('copied');
      window.setTimeout(() => setState('idle'), 1200);
    } catch {
      setState('error');
      window.setTimeout(() => setState('idle'), 1500);
    }
  }

  return (
    <button
      onClick={onCopy}
      className="border-fd-border bg-fd-secondary text-fd-secondary-foreground hover:bg-fd-accent hover:text-fd-accent-foreground inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors"
    >
      {state === 'copied' ? 'Copied' : state === 'error' ? 'Error' : 'Copy Markdown'}
    </button>
  );
}
