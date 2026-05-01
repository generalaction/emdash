import { ExternalLink } from 'lucide-react';
import { cn } from '@renderer/utils/utils';

interface DeprecationBannerProps {
  downloadUrl: string;
  onDownloadStable: (url: string) => void | Promise<void>;
  placement?: 'sidebar' | 'settings';
}

export function DeprecationBanner({
  downloadUrl,
  onDownloadStable,
  placement = 'sidebar',
}: DeprecationBannerProps) {
  return (
    <aside
      aria-label="Deprecation notice"
      className={cn(
        'rounded-xl border border-border bg-background text-foreground shadow-sm',
        placement === 'settings' ? 'w-full p-4' : 'mx-3 mb-3 p-3'
      )}
    >
      <p className="text-sm font-medium">Emdash v1-beta deprecated</p>
      <p className="mt-1 text-xs leading-5 text-foreground-muted">Emdash v1 is now stable.</p>
      <a
        href={downloadUrl}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => {
          event.preventDefault();
          void onDownloadStable(downloadUrl);
        }}
        aria-label="Download the new stable version of Emdash"
        className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-md text-xs font-medium text-foreground transition-colors hover:text-foreground-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        Download stable
        <ExternalLink className="size-3" />
      </a>
    </aside>
  );
}
