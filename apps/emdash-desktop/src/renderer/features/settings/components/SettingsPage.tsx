import { ExternalLink } from 'lucide-react';
import { useCallback, useState } from 'react';
import { PageHeader } from '@renderer/lib/components/page-header';
import { rpc } from '@renderer/lib/ipc';
import { SearchInput } from '@renderer/lib/ui/search-input';
import { cn } from '@renderer/utils/utils';
import type { SettingsPageTab } from './settings-page-config';
import { getSettingsSearchView } from './settings-search';

export type { SettingsPageTab } from './settings-page-config';

export function SettingsPage({
  tab: activeTab,
  onTabChange,
}: {
  tab: SettingsPageTab;
  onTabChange: (tab: SettingsPageTab) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const searchView = getSettingsSearchView(activeTab, searchQuery);

  const handleDocsClick = useCallback(() => {
    void rpc.app.openExternal('https://docs.emdash.sh');
  }, []);

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
              {searchView.isEmpty && (
                <div className="px-3 text-xs text-foreground-muted">No matching settings.</div>
              )}
              {!searchView.isEmpty && (
                <nav className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
                  {searchView.visibleTabs.map((tab) => {
                    const isActive = tab.id === searchView.displayedTab?.id && !tab.isExternal;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          if (tab.isExternal) {
                            handleDocsClick();
                          } else {
                            onTabChange(tab.id);
                          }
                        }}
                        className={cn(
                          'flex w-full items-center gap-2 hover:bg-background-1 text-foreground-muted hover:text-foreground rounded-md px-3 py-2 text-sm font-normal transition-colors',
                          isActive &&
                            'bg-background-2 text-foreground hover:bg-background-2 hover:text-foreground'
                        )}
                      >
                        <span className="text-left">{tab.label}</span>
                        {tab.isExternal && <ExternalLink className="h-4 w-4" />}
                      </button>
                    );
                  })}
                </nav>
              )}
            </div>
          </div>
          {searchView.displayedContent && (
            <div
              className={cn(
                'min-h-0 min-w-0 flex-1 justify-center overflow-x-hidden overflow-y-auto',
                '[scrollbar-gutter:stable]'
              )}
            >
              <div className="mx-auto w-full max-w-4xl space-y-8 px-4 py-10">
                <PageHeader
                  title={searchView.displayedContent.title}
                  description={searchView.displayedContent.description}
                />
                {searchView.visibleSections.map((section) => (
                  <div key={section.id} className="flex flex-col gap-3">
                    {section.title && (
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-normal text-foreground">{section.title}</h3>
                        {section.action && <div>{section.action}</div>}
                      </div>
                    )}
                    {section.component}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
