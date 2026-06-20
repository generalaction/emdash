import { Globe } from 'lucide-react';
import { useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import {
  browserBookmarkDisplayTitle,
  browserBookmarkFaviconUrl,
  type BrowserBookmark,
} from '@shared/browser-bookmarks';

export function BrowserBookmarkBar({
  bookmarks,
  onOpenUrl,
}: {
  bookmarks: readonly BrowserBookmark[];
  onOpenUrl: (url: string) => void;
}) {
  if (bookmarks.length === 0) return null;

  return (
    <div className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-background-secondary-1 px-2">
      {bookmarks.map((bookmark) => (
        <BrowserBookmarkItem
          key={bookmark.id}
          bookmark={bookmark}
          onOpenUrl={() => onOpenUrl(bookmark.url)}
        />
      ))}
    </div>
  );
}

function BrowserBookmarkItem({
  bookmark,
  onOpenUrl,
}: {
  bookmark: BrowserBookmark;
  onOpenUrl: () => void;
}) {
  const [failedFaviconUrl, setFailedFaviconUrl] = useState<string | null>(null);
  const faviconUrl = browserBookmarkFaviconUrl(bookmark);
  const showFavicon = faviconUrl && faviconUrl !== failedFaviconUrl;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={cn(
              'focus-visible:ring-ring/50 flex h-6 max-w-56 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-foreground-muted transition-colors hover:bg-background-quaternary-1 hover:text-foreground focus-visible:ring-3 focus-visible:outline-none'
            )}
            onClick={onOpenUrl}
          >
            {showFavicon ? (
              <img
                src={faviconUrl}
                alt=""
                className="size-3.5 shrink-0 rounded-sm"
                draggable={false}
                onError={() => setFailedFaviconUrl(faviconUrl)}
              />
            ) : (
              <Globe className="size-3.5 shrink-0 text-foreground-muted" />
            )}
            <span className="truncate">{browserBookmarkDisplayTitle(bookmark)}</span>
          </button>
        }
      />
      <TooltipContent>{bookmark.url}</TooltipContent>
    </Tooltip>
  );
}
