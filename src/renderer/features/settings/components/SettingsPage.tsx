import { formatForDisplay, useHotkey } from '@tanstack/react-hotkeys';
import { ExternalLink, Search, X } from 'lucide-react';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  searchSettings,
  SETTINGS_SEARCH_ENTRIES,
} from '@renderer/features/settings/settings-search-index';
import { rpc } from '@renderer/lib/ipc';
import { Input } from '@renderer/lib/ui/input';
import { Kbd, KbdGroup } from '@renderer/lib/ui/kbd';
import { Separator } from '@renderer/lib/ui/separator';
import { cn } from '@renderer/utils/utils';
import { AccountTab } from './AccountTab';
import { CliAgentsList } from './CliAgentsList';
import DefaultAgentSettingsCard from './DefaultAgentSettingsCard';
import HiddenToolsSettingsCard from './HiddenToolsSettingsCard';
import IntegrationsCard from './IntegrationsCard';
import KeyboardSettingsCard from './KeyboardSettingsCard';
import NotificationSettingsCard from './NotificationSettingsCard';
import RepositorySettingsCard from './RepositorySettingsCard';
import { ReviewPromptResetButton, ReviewPromptSettingsCard } from './ReviewPromptSettingsCard';
import { AutoGenerateTaskNamesRow, AutoTrustWorktreesRow } from './TaskSettingsRows';
import TelemetryCard from './TelemetryCard';
import TerminalSettingsCard from './TerminalSettingsCard';
import ThemeCard from './ThemeCard';
import { UpdateCard } from './UpdateCard';

export type SettingsPageTab =
  | 'general'
  | 'account'
  | 'clis-models'
  | 'integrations'
  | 'repository'
  | 'interface'
  | 'docs';

interface SectionConfig {
  anchor?: string;
  title?: string;
  action?: React.ReactNode;
  component: React.ReactNode;
}

const TAB_DEFINITIONS: Array<{ id: SettingsPageTab; label: string; isExternal?: boolean }> = [
  { id: 'general', label: 'General' },
  { id: 'account', label: 'Account' },
  { id: 'clis-models', label: 'Agents' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'repository', label: 'Repository' },
  { id: 'interface', label: 'Interface' },
  { id: 'docs', label: 'Docs', isExternal: true },
];

const TAB_ORDER: SettingsPageTab[] = TAB_DEFINITIONS.filter((t) => !t.isExternal).map((t) => t.id);

function renderSection(section: SectionConfig, idx: number) {
  const key = section.anchor ?? section.title ?? `section-${idx}`;
  return (
    <div key={key} className="flex flex-col gap-3">
      {section.title && (
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-normal text-foreground">{section.title}</h3>
          {section.action && <div>{section.action}</div>}
        </div>
      )}
      {section.component}
    </div>
  );
}

export function SettingsPage({
  tab: activeTab,
  onTabChange,
}: {
  tab: SettingsPageTab;
  onTabChange: (tab: SettingsPageTab) => void;
}) {
  const handleDocsClick = useCallback(() => {
    void rpc.app.openExternal('https://docs.emdash.sh');
  }, []);

  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useHotkey(
    'Mod+F',
    () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    },
    { enabled: true }
  );

  const focusHotkeyDisplay = useMemo(() => formatForDisplay('Mod+F'), []);

  const trimmedQuery = query.trim();
  const isSearching = trimmedQuery.length > 0;
  const results = useMemo(
    () => (isSearching ? searchSettings(SETTINGS_SEARCH_ENTRIES, trimmedQuery) : []),
    [isSearching, trimmedQuery]
  );

  const matchedAnchorsByTab = useMemo(() => {
    const map = new Map<SettingsPageTab, Set<string>>();
    if (!isSearching) return map;
    for (const entry of results) {
      if (!entry.anchor) continue;
      const set = map.get(entry.tab) ?? new Set<string>();
      set.add(entry.anchor);
      map.set(entry.tab, set);
    }
    return map;
  }, [isSearching, results]);

  const tabsWithMatches = useMemo(
    () => TAB_ORDER.filter((tab) => matchedAnchorsByTab.has(tab)),
    [matchedAnchorsByTab]
  );

  const tabContent = useMemo<
    Record<string, { title: string; description: string; sections: SectionConfig[] }>
  >(
    () => ({
      general: {
        title: 'General',
        description: 'Manage your account, privacy settings, notifications, and app updates.',
        sections: [
          { anchor: 'telemetry', component: <TelemetryCard /> },
          { anchor: 'auto-generate-task-names', component: <AutoGenerateTaskNamesRow /> },
          { anchor: 'auto-trust-worktrees', component: <AutoTrustWorktreesRow /> },
          { anchor: 'notifications', component: <NotificationSettingsCard /> },
          { anchor: 'update', component: <UpdateCard /> },
        ],
      },
      account: {
        title: 'Account',
        description: 'Manage your Emdash account.',
        sections: [{ anchor: 'account', component: <AccountTab /> }],
      },
      'clis-models': {
        title: 'Agents',
        description: 'Manage CLI agents and model configurations.',
        sections: [
          { anchor: 'default-agent', component: <DefaultAgentSettingsCard /> },
          {
            anchor: 'review-prompt',
            title: 'Review Prompt',
            action: <ReviewPromptResetButton />,
            component: <ReviewPromptSettingsCard />,
          },
          {
            anchor: 'cli-agents',
            title: 'CLI agents',
            component: (
              <div className="rounded-xl border border-border/60 bg-muted/10 p-2">
                <CliAgentsList />
              </div>
            ),
          },
        ],
      },
      integrations: {
        title: 'Integrations',
        description: 'Connect external services and tools.',
        sections: [
          { anchor: 'integrations', title: 'Integrations', component: <IntegrationsCard /> },
        ],
      },
      repository: {
        title: 'Repository',
        description: 'Configure repository and branch settings.',
        sections: [
          {
            anchor: 'branch-prefix',
            title: 'Branch prefix',
            component: <RepositorySettingsCard />,
          },
        ],
      },
      interface: {
        title: 'Interface',
        description: 'Customize the appearance and behavior of the app.',
        sections: [
          { anchor: 'theme', component: <ThemeCard /> },
          { anchor: 'terminal', component: <TerminalSettingsCard /> },
          {
            anchor: 'keyboard-shortcuts',
            title: 'Keyboard shortcuts',
            component: <KeyboardSettingsCard />,
          },
          {
            anchor: 'tools',
            title: 'Tools',
            component: <HiddenToolsSettingsCard />,
          },
        ],
      },
    }),
    []
  );

  const currentContent = tabContent[activeTab as keyof typeof tabContent];

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1060px] flex-col gap-6 px-8">
        <div className="grid min-h-0 flex-1 grid-cols-[13rem_minmax(0,1fr)] gap-8 overflow-hidden">
          <div className="flex min-h-0 flex-col gap-3 py-10">
            <div className="relative px-0.5">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-muted"
                aria-hidden="true"
              />
              <Input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search settings…"
                aria-label="Search settings"
                className="pl-8 pr-14"
              />
              {isSearching ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-foreground-muted hover:bg-background-1 hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : (
                <span
                  className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"
                  aria-hidden="true"
                >
                  <KbdGroup>
                    {focusHotkeyDisplay.split('+').map((key) => (
                      <Kbd key={key}>{key.trim()}</Kbd>
                    ))}
                  </KbdGroup>
                </span>
              )}
            </div>
            <nav className="flex min-h-0 w-52 flex-col gap-0.5 overflow-y-auto">
              {TAB_DEFINITIONS.map((tab) => {
                const isActive = tab.id === activeTab && !tab.isExternal;
                const hasMatch = !tab.isExternal && matchedAnchorsByTab.has(tab.id);
                const isDimmed = isSearching && !tab.isExternal && !hasMatch;
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
                        'bg-background-2 text-foreground hover:bg-background-2 hover:text-foreground',
                      isDimmed && 'opacity-40'
                    )}
                  >
                    <span className="text-left">{tab.label}</span>
                    {tab.isExternal && <ExternalLink className="h-4 w-4" />}
                  </button>
                );
              })}
            </nav>
          </div>
          <div className="min-h-0 min-w-0 flex-1 justify-center overflow-x-hidden overflow-y-auto">
            <div className="mx-auto w-full max-w-4xl space-y-8 py-10">
              {isSearching ? (
                <>
                  <div className="flex flex-col gap-6">
                    <div className="flex flex-col gap-1">
                      <h2 className="text-xl">Search</h2>
                      <p className="text-sm text-foreground-muted">
                        {tabsWithMatches.length === 0
                          ? `No settings match “${trimmedQuery}”.`
                          : `Showing results for “${trimmedQuery}”.`}
                      </p>
                    </div>
                    <Separator />
                  </div>
                  {tabsWithMatches.map((tabId) => {
                    const conf = tabContent[tabId];
                    const anchors = matchedAnchorsByTab.get(tabId);
                    const sections = conf.sections.filter(
                      (s) => s.anchor && anchors?.has(s.anchor)
                    );
                    if (sections.length === 0) return null;
                    return (
                      <div key={tabId} className="flex flex-col gap-4">
                        <button
                          type="button"
                          onClick={() => {
                            setQuery('');
                            onTabChange(tabId);
                          }}
                          className="self-start text-xs uppercase tracking-wide text-foreground-muted hover:text-foreground"
                        >
                          {conf.title}
                        </button>
                        {sections.map(renderSection)}
                      </div>
                    );
                  })}
                </>
              ) : (
                currentContent && (
                  <>
                    <div className="flex flex-col gap-6">
                      <div className="flex flex-col gap-1">
                        <h2 className="text-xl">{currentContent.title}</h2>
                        <p className="text-sm text-foreground-muted">
                          {currentContent.description}
                        </p>
                      </div>
                      <Separator />
                    </div>
                    {currentContent.sections.map(renderSection)}
                  </>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
