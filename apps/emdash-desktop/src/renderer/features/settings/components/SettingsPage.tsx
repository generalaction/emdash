import { ExternalLink } from 'lucide-react';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { PageHeader } from '@renderer/lib/components/page-header';
import { rpc } from '@renderer/lib/ipc';
import { SearchInput } from '@renderer/lib/ui/search-input';
import { cn } from '@renderer/utils/utils';
import type { SectionConfig, SettingsPageTab } from './settings-page-config';
import { getSettingsSearchView } from './settings-search';

export type { SettingsPageTab } from './settings-page-config';

/** Wrap the matched substring of `text` in a highlight; plain text when the match is keyword-only. */
function highlightMatch(text: string, normalizedQuery: string): ReactNode {
  if (!normalizedQuery) return text;
  const index = text.toLowerCase().indexOf(normalizedQuery);
  if (index === -1) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark className="bg-primary/20 rounded-[3px] px-0.5 text-foreground">
        {text.slice(index, index + normalizedQuery.length)}
      </mark>
      {text.slice(index + normalizedQuery.length)}
    </>
  );
}

export function SettingsPage({
  tab: activeTab,
  onTabChange,
}: {
  tab: SettingsPageTab;
  onTabChange: (tab: SettingsPageTab) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const searchView = getSettingsSearchView(activeTab, searchQuery);
  const { normalizedQuery, displayedTab, displayedContent, resultGroups, totalMatches } =
    searchView;
  const groupRefs = useRef<Record<string, HTMLElement | null>>({});

  const handleDocsClick = useCallback(() => {
    void rpc.app.openExternal('https://docs.emdash.sh');
  }, []);

  const renderSection = (section: SectionConfig) => (
    <div key={section.id} className="flex flex-col gap-3">
      {section.title && (
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-normal text-foreground">
            {normalizedQuery ? highlightMatch(section.title, normalizedQuery) : section.title}
          </h3>
          {section.action && <div>{section.action}</div>}
        </div>
      )}
      {section.component}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1060px] flex-col gap-6 px-8">
        <div className="grid min-h-0 flex-1 grid-cols-[13rem_minmax(0,1fr)] gap-8 overflow-hidden">
          <div className="py-10">
            <div className="flex min-h-0 w-52 flex-col gap-3">
              <SearchInput
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.currentTarget.value)}
                onClear={() => setSearchQuery('')}
                placeholder="Search settings"
                aria-label="Search settings"
                clearLabel="Clear settings search"
                selectOnHotkey
                containerClassName="mx-0.5"
                className="h-9"
              />
              <div role="status" aria-live="polite" className="sr-only">
                {normalizedQuery
                  ? totalMatches > 0
                    ? `${totalMatches} settings match ${searchQuery.trim()}`
                    : `No settings match ${searchQuery.trim()}`
                  : ''}
              </div>
              <nav
                aria-label="Settings sections"
                className="flex min-h-0 flex-col gap-0.5 overflow-y-auto"
              >
                {searchView.tabMatches.map(({ tab, count }) => {
                  const isActive =
                    !normalizedQuery && tab.id === displayedTab?.id && !tab.isExternal;
                  const dimmed = Boolean(normalizedQuery) && !tab.isExternal && count === 0;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        if (tab.isExternal) {
                          handleDocsClick();
                        } else if (normalizedQuery && groupRefs.current[tab.id]) {
                          groupRefs.current[tab.id]?.scrollIntoView({
                            behavior: 'smooth',
                            block: 'start',
                          });
                        } else {
                          onTabChange(tab.id);
                        }
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 hover:bg-background-1 text-foreground-muted hover:text-foreground rounded-md px-3 py-2 text-sm font-normal transition-colors',
                        isActive &&
                          'bg-background-2 text-foreground hover:bg-background-2 hover:text-foreground',
                        dimmed && 'opacity-40'
                      )}
                    >
                      <span className="flex-1 truncate text-left">
                        {normalizedQuery ? highlightMatch(tab.label, normalizedQuery) : tab.label}
                      </span>
                      {tab.isExternal && <ExternalLink className="h-4 w-4 shrink-0" />}
                      {!tab.isExternal && normalizedQuery && count > 0 && (
                        <span className="shrink-0 rounded-full bg-background-1 px-1.5 text-xs text-foreground-muted tabular-nums">
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>
          </div>
          <div
            className={cn(
              'min-h-0 min-w-0 flex-1 justify-center overflow-x-hidden overflow-y-auto',
              '[scrollbar-gutter:stable]'
            )}
          >
            <div className="mx-auto w-full max-w-4xl px-4 py-10">
              {normalizedQuery ? (
                resultGroups.length > 0 ? (
                  <div className="space-y-12">
                    {resultGroups.map((group) => (
                      <section
                        key={group.tab.id}
                        ref={(el) => {
                          groupRefs.current[group.tab.id] = el;
                        }}
                        className="scroll-mt-4 space-y-6"
                      >
                        <div className="border-b border-border/60 pb-2">
                          <h2 className="text-base font-semibold text-foreground">
                            {highlightMatch(group.title, normalizedQuery)}
                          </h2>
                        </div>
                        {group.sections.map(renderSection)}
                      </section>
                    ))}
                  </div>
                ) : (
                  <div className="py-16 text-center text-sm text-foreground-muted">
                    No settings match “{searchQuery.trim()}”.
                  </div>
                )
              ) : (
                displayedContent && (
                  <div className="space-y-8">
                    <PageHeader
                      title={displayedContent.title}
                      description={displayedContent.description}
                    />
                    {displayedContent.sections.map(renderSection)}
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
