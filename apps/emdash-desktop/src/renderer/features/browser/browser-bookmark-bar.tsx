import { Globe, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
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

const BOOKMARK_BAR_HEIGHT_PX = 32;

export function BrowserBookmarkBar({
  visible,
  bookmarks,
  onOpenUrl,
  onReorder,
  onRemove,
}: {
  visible: boolean;
  bookmarks: readonly BrowserBookmark[];
  onOpenUrl: (url: string) => void;
  onReorder: (bookmarks: BrowserBookmark[]) => void;
  onRemove: (bookmarkId: string) => void;
}) {
  const shouldShow = visible && bookmarks.length > 0;

  const handleReorder = (orderedBookmarks: BrowserBookmark[]) => {
    onReorder(reorderBrowserBookmarksToMatch(bookmarks, orderedBookmarks));
  };

  return (
    <AnimatePresence initial={false}>
      {shouldShow && (
        <motion.div
          key="browser-bookmark-bar"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: BOOKMARK_BAR_HEIGHT_PX, opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
          className="overflow-hidden"
        >
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
        </motion.div>
      )}
    </AnimatePresence>
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
