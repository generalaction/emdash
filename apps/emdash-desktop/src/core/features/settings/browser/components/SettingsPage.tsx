import {
  PageLayout,
  type PageNavItem,
  type PageNavDivider,
  type PageSidebarMenuItem,
} from '@emdash/ui/react/patterns';
import type { SettingsPageTab } from '@core/features/settings/contributions/views';
import { settingsPageContributions } from '@core/manifests/browser/settings-page-contributions';
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
  const activePage = settingsPageContributions.find(({ id }) => id === activeTab);
  const PageComponent = activePage?.component;

  return (
    <PageLayout
      sidebar={
        <PageLayout.SidebarMenu
          items={SIDEBAR_ITEMS}
          activeId={activeTab}
          draggable
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
  );
}
