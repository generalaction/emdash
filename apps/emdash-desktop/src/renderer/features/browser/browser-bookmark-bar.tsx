import { Globe, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ReorderList } from '@renderer/lib/components/reorder-list';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import {
  browserBookmarkDisplayTitle,
  browserBookmarkFaviconUrl,
  reorderBrowserBookmarksToMatch,
  type BrowserBookmark,
} from '@shared/browser-bookmarks';

export function BrowserBookmarkBar({
  bookmarks,
  onOpenUrl,
  onReorder,
  onRemove,
}: {
  bookmarks: readonly BrowserBookmark[];
  onOpenUrl: (url: string) => void;
  onReorder: (bookmarks: BrowserBookmark[]) => void;
  onRemove: (bookmarkId: string) => void;
}) {
  if (bookmarks.length === 0) return null;

  const handleReorder = (orderedBookmarks: BrowserBookmark[]) => {
    onReorder(reorderBrowserBookmarksToMatch(bookmarks, orderedBookmarks));
  };

  return (
    <div className="flex h-8 shrink-0 border-b border-border bg-background-secondary-1 px-2">
      <ReorderList
        items={[...bookmarks]}
        onReorder={handleReorder}
        axis="x"
        className="flex h-full w-full items-center gap-1 overflow-x-auto"
        itemClassName="list-none flex shrink-0"
        getKey={(bookmark) => bookmark.id}
      >
        {(bookmark) => (
          <BrowserBookmarkItem
            bookmark={bookmark}
            onOpenUrl={() => onOpenUrl(bookmark.url)}
            onRemove={() => onRemove(bookmark.id)}
          />
        )}
      </ReorderList>
    </div>
  );
}

function BrowserBookmarkItem({
  bookmark,
  onOpenUrl,
  onRemove,
}: {
  bookmark: BrowserBookmark;
  onOpenUrl: () => void;
  onRemove: () => void;
}) {
  const [failedFaviconUrl, setFailedFaviconUrl] = useState<string | null>(null);
  const faviconUrl = browserBookmarkFaviconUrl(bookmark);
  const showFavicon = faviconUrl && faviconUrl !== failedFaviconUrl;
  const title = browserBookmarkDisplayTitle(bookmark);

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className={cn(
                  'focus-visible:ring-ring/50 flex h-6 max-w-56 shrink-0 cursor-grab items-center gap-1.5 rounded-md px-2 text-xs text-foreground-muted transition-colors hover:bg-background-quaternary-1 hover:text-foreground focus-visible:ring-3 focus-visible:outline-none active:cursor-grabbing'
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
                <span className="truncate">{title}</span>
              </button>
            }
          />
          <TooltipContent>{bookmark.url}</TooltipContent>
        </Tooltip>
      </ContextMenuTrigger>
      <ContextMenuContent finalFocus={false}>
        <ContextMenuItem variant="destructive" onClick={onRemove}>
          <Trash2 className="size-4" />
          Remove bookmark
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
