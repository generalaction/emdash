import {
  PageLayout,
  type PageNavItem,
  type PageNavDivider,
  type PageSidebarMenuItem,
} from '@emdash/ui/react/patterns';
import { useEffect, useMemo, useState } from 'react';
import {
  matchedTabsForQuery,
  searchSettings,
} from '@core/features/settings/browser/search/settings-search';
import { SettingsSearchProvider } from '@core/features/settings/browser/search/settings-search-context';
import type { SettingsPageTab } from '@core/features/settings/contributions/views';
import { settingsPageContributions } from '@core/manifests/browser/settings-page-contributions';
import { SearchInput } from '@core/primitives/ui/browser/search-input';
import { rpc } from '@renderer/lib/runtime/desktop-host-client';

const DOCS_ITEM = {
  id: 'docs',
  label: 'Docs',
  icon: 'external-link',
  isExternal: true,
} satisfies PageNavItem;

const DIVIDER: PageNavDivider = { kind: 'divider' };

const SIDEBAR_ITEMS: PageSidebarMenuItem[] = [
  ...settingsPageContributions.slice(0, 3).map(toNavItem),
  DIVIDER,
  ...settingsPageContributions.slice(3, 6).map(toNavItem),
  DIVIDER,
  ...settingsPageContributions.slice(6, 8).map(toNavItem),
  DIVIDER,
  ...settingsPageContributions.slice(8, 9).map(toNavItem),
  DIVIDER,
  DOCS_ITEM,
];

function toNavItem({ id, label, icon }: PageNavItem): PageNavItem {
  return { id, label, icon };
}

export function SettingsPage({
  tab: activeTab,
  onTabChange,
}: {
  tab: SettingsPageTab;
  onTabChange: (tab: SettingsPageTab) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const query = searchQuery.trim();
  const isSearching = query.length > 0;
  const activePage = settingsPageContributions.find(({ id }) => id === activeTab);
  const PageComponent = activePage?.component;

  const visiblePages = useMemo(() => {
    if (!isSearching) return [...settingsPageContributions];
    const matchedTabs = new Set(matchedTabsForQuery(query));
    return settingsPageContributions.filter((page) => matchedTabs.has(page.id));
  }, [isSearching, query]);

  const visibleItems = useMemo<PageSidebarMenuItem[]>(() => {
    if (!isSearching) return SIDEBAR_ITEMS;
    const matchCountByTab = new Map<string, number>();
    for (const entry of searchSettings(query)) {
      matchCountByTab.set(entry.tab, (matchCountByTab.get(entry.tab) ?? 0) + 1);
    }
    return visiblePages.map((page) => ({
      ...toNavItem(page),
      badge: String(matchCountByTab.get(page.id) ?? 0),
    }));
  }, [isSearching, query, visiblePages]);

  useEffect(() => {
    if (!isSearching || visiblePages.length === 0) return;
    if (!visiblePages.some((page) => page.id === activeTab)) {
      onTabChange(visiblePages[0]!.id);
    }
  }, [activeTab, isSearching, onTabChange, visiblePages]);

  return (
    <SettingsSearchProvider query={searchQuery}>
      <PageLayout
        sidebar={
          <PageLayout.SidebarMenu
            items={visibleItems}
            activeId={activeTab}
            draggable
            header={
              <SearchInput
                placeholder="Search settings"
                aria-label="Search settings"
                aria-keyshortcuts="Meta+F Control+F /"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                shortcutHotkey="Mod+F"
                focusSlashHotkey
              />
            }
            emptyMessage={isSearching ? 'No settings found' : undefined}
            onSelect={(item) => {
              if (item.isExternal) {
                void rpc.app.openExternal('https://docs.emdash.sh');
                return;
              }

              const page = settingsPageContributions.find(({ id }) => id === item.id);
              if (page) onTabChange(page.id);
            }}
          />
        }
      >
        {PageComponent ? (
          <PageLayout.Content>
            <PageComponent />
          </PageLayout.Content>
        ) : null}
      </PageLayout>
    </SettingsSearchProvider>
  );
}
