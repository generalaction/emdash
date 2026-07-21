import { PageLayout, type PageNavItem } from '@emdash/ui/react/patterns';
import type { SettingsPageTab } from '@core/features/settings/contributions/views';
import { settingsPageContributions } from '@core/manifests/browser/settings-page-contributions';
import { rpc } from '@renderer/lib/runtime/desktop-host-client';

const DOCS_ITEM = {
  id: 'docs',
  label: 'Docs',
  icon: 'external-link',
  isExternal: true,
} satisfies PageNavItem;

export function SettingsPage({
  tab: activeTab,
  onTabChange,
}: {
  tab: SettingsPageTab;
  onTabChange: (tab: SettingsPageTab) => void;
}) {
  const sidebarItems: PageNavItem[] = [
    ...settingsPageContributions.map(({ id, label, icon }) => ({ id, label, icon })),
    DOCS_ITEM,
  ];
  const activePage = settingsPageContributions.find(({ id }) => id === activeTab);
  const PageComponent = activePage?.component;

  return (
    <PageLayout
      sidebar={
        <PageLayout.SidebarMenu
          items={sidebarItems}
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
