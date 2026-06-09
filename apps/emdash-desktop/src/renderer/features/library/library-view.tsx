import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { McpView } from '@renderer/features/mcp/components/McpView';
import { SkillsView } from '@renderer/features/skills/components/SkillsView';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { cn } from '@renderer/utils/utils';
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
  const { setParams } = useParams('library');
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

export function LibraryTitlebar() {
  return (
    <Titlebar
      leftSlot={
        <div className="flex items-center px-2">
          <span className="text-sm text-foreground-muted">Library</span>
        </div>
      }
    />
  );
}

export function LibraryMainPanel() {
  const { tab, onTabChange } = useLibraryTab();

  return (
    <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden bg-background">
      <div className="mx-auto grid h-full min-h-0 w-full max-w-[1060px] grid-cols-[13rem_minmax(0,1fr)] gap-8 px-8">
        <div className="py-10">
          <nav className="flex min-h-0 w-52 flex-col gap-0.5 overflow-y-auto">
            {tabs.map((item) => {
              const isActive = item.id === tab;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onTabChange(item.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-normal text-foreground-muted transition-colors hover:bg-background-1 hover:text-foreground',
                    isActive &&
                      'bg-background-2 text-foreground hover:bg-background-2 hover:text-foreground'
                  )}
                >
                  <span className="text-left">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {tab === 'prompts' && <PromptLibraryView />}
          {tab === 'skills' && <SkillsView />}
          {tab === 'mcp' && <McpView />}
        </div>
      </div>
    </div>
  );
}

export const libraryView = {
  WrapView: LibraryViewWrapper,
  TitlebarSlot: LibraryTitlebar,
  MainPanel: LibraryMainPanel,
};
