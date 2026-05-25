import { motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { useEffect, useRef, useState, type Ref } from 'react';
import { Button } from '@renderer/lib/ui/button';
import { SearchInput } from '@renderer/lib/ui/search-input';

interface AutomationsHeaderProps {
  title: string;
  subtitle: string;
  showActions: boolean;
  showNewButton: boolean;
  panelOpen: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  searchExpanded: boolean;
  onExpandSearch: () => void;
  onCollapseSearch: () => void;
  searchInputRef: Ref<HTMLInputElement>;
  createPending: boolean;
  onNewAutomation: () => void;
}

const TRANSITION = { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const };
const COLLAPSE_WIDTH_THRESHOLD = 520;
const COLLAPSED_SEARCH_WIDTH = '2.25rem';
const EXPANDED_SEARCH_WIDTH = '16rem';
const EXPANDED_SEARCH_WIDTH_PANEL = '12rem';

export function AutomationsHeader({
  title,
  subtitle,
  showActions,
  showNewButton,
  panelOpen,
  search,
  onSearchChange,
  searchPlaceholder,
  searchExpanded,
  onExpandSearch,
  onCollapseSearch,
  searchInputRef,
  createPending,
  onNewAutomation,
}: AutomationsHeaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setIsNarrow(entry.contentRect.width < COLLAPSE_WIDTH_THRESHOLD);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const collapsed = isNarrow && !searchExpanded && !search;

  return (
    <div ref={containerRef} className="mb-6">
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold">{title}</h1>
        <p className="text-muted-foreground mt-1 max-w-md text-xs text-pretty">{subtitle}</p>
      </div>

      {showActions && (
        <motion.div
          layout
          transition={TRANSITION}
          className="mt-4 flex items-center justify-between gap-2"
        >
          <motion.div
            animate={{
              width: collapsed
                ? COLLAPSED_SEARCH_WIDTH
                : panelOpen
                  ? EXPANDED_SEARCH_WIDTH_PANEL
                  : EXPANDED_SEARCH_WIDTH,
            }}
            transition={TRANSITION}
            className="min-w-0 overflow-hidden"
          >
            <SearchInput
              ref={searchInputRef}
              placeholder={searchPlaceholder}
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              onFocus={() => {
                if (collapsed) onExpandSearch();
              }}
              onBlur={() => {
                if (panelOpen && !search) onCollapseSearch();
              }}
              aria-label={searchPlaceholder}
              className="w-full min-w-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none"
            />
          </motion.div>

          {showNewButton ? (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 whitespace-nowrap"
              disabled={createPending}
              onClick={onNewAutomation}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New Automation
            </Button>
          ) : null}
        </motion.div>
      )}
    </div>
  );
}
