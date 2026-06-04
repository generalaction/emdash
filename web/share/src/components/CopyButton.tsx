import { useRef, useState } from 'react';

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (
    <button
      type="button"
      className="ghost-button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          if (resetTimer.current) clearTimeout(resetTimer.current);
          resetTimer.current = setTimeout(() => setCopied(false), 1600);
        });
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
