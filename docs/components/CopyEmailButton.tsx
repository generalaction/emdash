'use client';

import * as React from 'react';

export function CopyEmailButton({ email }: { email: string }) {
  const [state, setState] = React.useState<'idle' | 'copied'>('idle');

  function onCopy() {
    navigator.clipboard.writeText(email);
    setState('copied');
    window.setTimeout(() => setState('idle'), 1200);
  }

  return (
    <button
      onClick={onCopy}
      className="border-fd-border bg-fd-secondary text-fd-secondary-foreground hover:bg-fd-accent hover:text-fd-accent-foreground inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors"
    >
      {state === 'copied' ? 'Copied' : email}
    </button>
  );
}
