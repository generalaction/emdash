import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Search } from 'lucide-react';
import { type Ref } from 'react';
import { Button } from '@renderer/lib/ui/button';
import { SearchInput } from '@renderer/lib/ui/search-input';
import { cn } from '@renderer/utils/utils';

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
const ACTION_TRANSITION = { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const };

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
  const collapsed = panelOpen && !searchExpanded && !search;

  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold">{title}</h1>
        <p className="mt-1 max-w-md text-pretty text-xs text-muted-foreground">{subtitle}</p>
      </div>

      {showActions && (
        <motion.div layout transition={TRANSITION} className="flex shrink-0 items-center gap-2">
          <AnimatePresence initial={false} mode="popLayout">
            {collapsed ? (
              <motion.div
                key="collapsed-actions"
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.92 }}
                transition={ACTION_TRANSITION}
                className="flex items-center gap-2"
              >
                <Button
                  size="icon-sm"
                  variant="outline"
                  className="focus-visible:border-border focus-visible:ring-0"
                  aria-label="Search"
                  onClick={onExpandSearch}
                >
                  <Search className="h-3.5 w-3.5" />
                </Button>
                {showNewButton ? (
                  <Button
                    size="icon-sm"
                    variant="outline"
                    className="focus-visible:border-border focus-visible:ring-0"
                    aria-label="New automation"
                    disabled={createPending}
                    onClick={onNewAutomation}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </motion.div>
            ) : (
              <motion.div
                key="expanded-actions"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={ACTION_TRANSITION}
                className="flex items-center gap-2"
              >
                <SearchInput
                  ref={searchInputRef}
                  placeholder={searchPlaceholder}
                  value={search}
                  onChange={(event) => onSearchChange(event.target.value)}
                  onBlur={() => {
                    if (panelOpen && !search) onCollapseSearch();
                  }}
                  aria-label={searchPlaceholder}
                  className={cn(
                    'min-w-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none',
                    panelOpen ? 'w-48' : 'w-64'
                  )}
                />
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
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
