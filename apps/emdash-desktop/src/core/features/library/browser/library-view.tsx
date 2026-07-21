import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { libraryViewDef } from '@core/features/library/contributions/views';
import { McpView } from '@core/features/mcp/api/browser/components/McpView';
import { SkillsView } from '@core/features/skills/api/browser/components/SkillsView';
import {
  PageContent,
  PageLayout,
  PageSidebarMenu,
} from '@core/primitives/ui/browser/components/page-layout';
import { defineViewRuntime } from '@core/primitives/views/react';
import { useCurrentViewParams } from '@renderer/lib/layout/navigation-provider';
import { PromptLibraryView } from './prompts/prompt-library-view';

export type LibraryTab = 'prompts' | 'skills' | 'mcp';

const tabs: Array<{ id: LibraryTab; label: string }> = [
  { id: 'prompts', label: 'Prompts' },
  { id: 'skills', label: 'Skills' },
  { id: 'mcp', label: 'MCP' },
];

const LibraryTabContext = createContext<{
  tab: LibraryTab;
  onTabChange: (tab: LibraryTab) => void;
}>({ tab: 'prompts', onTabChange: () => {} });

export function LibraryViewWrapper({
  children,
  tab = 'prompts',
}: {
  children: ReactNode;
  tab?: LibraryTab;
}) {
  const { setParams } = useCurrentViewParams(libraryViewDef);
  const handleTabChange = useCallback(
    (nextTab: LibraryTab) => {
      setParams({ tab: nextTab });
    },
    [setParams]
  );

  return (
    <LibraryTabContext.Provider value={{ tab, onTabChange: handleTabChange }}>
      {children}
    </LibraryTabContext.Provider>
  );
}

function useLibraryTab() {
  const context = useContext(LibraryTabContext);
  if (!context) {
    throw new Error('useLibraryTab must be used within a LibraryViewWrapper');
  }
  return context;
}

export function LibraryMainPanel() {
  const { tab, onTabChange } = useLibraryTab();

  return (
    <PageLayout
      sidebar={
        <PageSidebarMenu items={tabs} activeId={tab} onSelect={(item) => onTabChange(item.id)} />
      }
    >
      <PageContent className="max-w-3xl">
        {tab === 'prompts' && <PromptLibraryView />}
        {tab === 'skills' && <SkillsView />}
        {tab === 'mcp' && <McpView />}
      </PageContent>
    </PageLayout>
  );
}

export const libraryViewRuntime = defineViewRuntime(libraryViewDef, {
  slots: {
    wrap: LibraryViewWrapper,
    main: LibraryMainPanel,
  },
});
