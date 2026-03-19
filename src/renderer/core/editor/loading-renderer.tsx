import { useEffect, useState } from 'react';

/** Delay before showing the spinner to avoid flash on fast local reads. */
const SPINNER_DELAY_MS = 300;

/**
 * Shown while a file's content is being fetched.
 * Renders nothing for the first 300ms to avoid a spinner flash on fast
 * local reads; only appears for noticeably slow loads (e.g. SSH).
 */
export function LoadingRenderer() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), SPINNER_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div className="flex h-full items-center justify-center">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
    </div>
  );
}
