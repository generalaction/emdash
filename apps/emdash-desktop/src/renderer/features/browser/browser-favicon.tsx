import { useState, type ReactNode } from 'react';

export function BrowserFavicon({
  faviconUrl,
  fallback,
  className,
}: {
  faviconUrl?: string;
  fallback: ReactNode;
  className?: string;
}) {
  return (
    <BrowserFaviconContent
      key={faviconUrl ?? 'browser-favicon-fallback'}
      faviconUrl={faviconUrl}
      fallback={fallback}
      className={className}
    />
  );
}

function BrowserFaviconContent({
  faviconUrl,
  fallback,
  className,
}: {
  faviconUrl?: string;
  fallback: ReactNode;
  className?: string;
}) {
  const [hasFailed, setHasFailed] = useState(false);

  if (!faviconUrl || hasFailed) return fallback;

  return (
    <img
      src={faviconUrl}
      alt=""
      className={className}
      draggable={false}
      onError={() => setHasFailed(true)}
    />
  );
}
