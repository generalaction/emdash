import {
  PageLayout,
  type PageNavItem,
  type PageNavDivider,
  type PageNavSection,
  type PageSidebarMenuItem,
} from '@emdash/ui/react/patterns';
import { Breadcrumbs, Kbd, SearchInput } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  matchedTabsForQuery,
  searchSettings,
} from '@core/features/settings/browser/search/settings-search';
import { SettingsSearchProvider } from '@core/features/settings/browser/search/settings-search-context';
import type { SettingsPageTab } from '@core/features/settings/contributions/views';
import { settingsPageContributions } from '@core/manifests/browser/settings-page-contributions';
import { chord, detectPlatformContext } from '@core/primitives/keybindings/api';
import {
  isTextInputFocusTarget,
  keyboardLayoutService,
  useChordKeydown,
} from '@core/primitives/keybindings/browser';
import { rpc } from '@renderer/lib/runtime/desktop-host-client';

const DOCS_ITEM = {
  id: 'docs',
  label: 'Docs',
  icon: 'external-link',
  isExternal: true,
} satisfies PageNavItem;

const DIVIDER: PageNavDivider = { kind: 'divider' };
const LOCAL_SECTION: PageNavSection = { kind: 'section', id: 'local', label: 'Local' };
const REMOTE_SECTION: PageNavSection = { kind: 'section', id: 'remote', label: 'Remote' };
const SETTINGS_SEARCH_HOTKEY = chord('Mod+F');

const SIDEBAR_ITEMS: PageSidebarMenuItem[] = [
  navItemFor('general'),
  navItemFor('integrations'),
  navItemFor('interface'),
  navItemFor('browser'),
  navItemFor('repository'),
  navItemFor('prompts'),
  LOCAL_SECTION,
  navItemFor('system'),
  navItemFor('workspaces-local'),
  navItemFor('clis-models'),
  navItemFor('mcp'),
  navItemFor('skills'),
  REMOTE_SECTION,
  navItemFor('connections'),
  DIVIDER,
  DOCS_ITEM,
];

function navItemFor(id: Exclude<SettingsPageTab, 'docs'>): PageNavItem {
  const page = settingsPageContributions.find((contribution) => contribution.id === id);
  if (!page) throw new Error(`Unknown settings page: ${id}`);
  return toNavItem(page);
}

function toNavItem({ id, label, icon }: PageNavItem): PageNavItem {
  return { id, label, icon };
}

export const SettingsPage = observer(function SettingsPage({
  tab: activeTab,
  detail,
  onTabChange,
  openDetail,
  closeDetail,
}: {
  tab: SettingsPageTab;
  detail?: string;
  onTabChange: (tab: SettingsPageTab) => void;
  openDetail: (detailId: string) => void;
  closeDetail: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const query = searchQuery.trim();
  const isSearching = query.length > 0;
  const activePage = settingsPageContributions.find(({ id }) => id === activeTab);
  const PageComponent = activePage?.component;
  const detailContribution = activePage?.detail;
  const detailLabel =
    detail && detailContribution ? detailContribution.breadcrumbLabel(detail) : null;

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

  useEffect(() => {
    if (detail && (!detailContribution || detailLabel === null)) {
      closeDetail();
    }
  }, [closeDetail, detail, detailContribution, detailLabel]);

  const detailView =
    detail && detailContribution && detailLabel !== null && activePage
      ? {
          Component: detailContribution.component,
          detailId: detail,
          label: detailLabel,
          pageId: activePage.id,
          pageLabel: activePage.label,
        }
      : null;

  const focusSearchInput = useCallback(() => {
    searchInputRef.current?.focus();
  }, []);

  useChordKeydown(
    'Mod+F',
    (event) => {
      event.preventDefault();
      focusSearchInput();
    },
    { enabled: true }
  );

  useChordKeydown(
    '/',
    (event) => {
      if (isTextInputFocusTarget(event.target)) return;
      event.preventDefault();
      focusSearchInput();
    },
    { enabled: true }
  );

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
                ref={searchInputRef}
                placeholder="Search settings"
                aria-label="Search settings"
                aria-keyshortcuts="Meta+F Control+F /"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onClear={() => setSearchQuery('')}
                shortcut={<SettingsSearchShortcut />}
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
        {detailView ? (
          <PageLayout.Content>
            <div className="sticky top-0 z-10 bg-background pt-10 pb-4">
              <Breadcrumbs
                items={[
                  {
                    id: detailView.pageId,
                    label: detailView.pageLabel,
                    onSelect: closeDetail,
                  },
                  { id: detailView.detailId, label: detailView.label },
                ]}
              />
            </div>
            <detailView.Component detailId={detailView.detailId} closeDetail={closeDetail} />
          </PageLayout.Content>
        ) : PageComponent ? (
          <PageLayout.Content>
            <PageComponent openDetail={openDetail} />
          </PageLayout.Content>
        ) : null}
      </PageLayout>
    </SettingsSearchProvider>
  );
});

function SettingsSearchShortcut() {
  const [, setLayoutVersion] = useState(0);

  useEffect(
    () => keyboardLayoutService.onDidChangeLayout(() => setLayoutVersion((version) => version + 1)),
    []
  );

  const keys = keyboardLayoutService.displayLabel(SETTINGS_SEARCH_HOTKEY, detectPlatformContext());

  return (
    <span aria-hidden="true" className="inline-flex items-center gap-0.5">
      {keys.map((key, index) => (
        <Kbd key={`${key}-${index}`}>{key}</Kbd>
      ))}
    </span>
  );
}
