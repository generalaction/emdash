import {
  type SectionConfig,
  type SettingsContentTab,
  type SettingsNavTab,
  type SettingsPageTab,
  settingsTabContent,
  settingsTabs,
} from './settings-page-config';

type ContentNavTab = {
  id: SettingsContentTab;
  label: string;
  isExternal?: false;
};

export interface SettingsTabMatch {
  tab: SettingsNavTab;
  /** Sections this tab would show under the current query (0 = no hit). */
  count: number;
}

export interface SettingsSearchResult {
  id: string;
  tab: SettingsContentTab;
  title: string;
  subtitle: string;
  score: number;
}

export interface SettingsResultGroup {
  tab: ContentNavTab;
  title: string;
  description: string;
  sections: SectionConfig[];
}

function matchesSearch(parts: Array<string | undefined>, normalizedQuery: string) {
  return parts.filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery);
}

function tabHeaderMatchesSearch(tab: SettingsNavTab, normalizedQuery: string) {
  if (!normalizedQuery || tab.isExternal) return false;

  const content = settingsTabContent[tab.id];
  return matchesSearch([tab.label, content.title, content.description], normalizedQuery);
}

function sectionMatchesSearch(section: SectionConfig, normalizedQuery: string) {
  return matchesSearch([section.title, section.searchText], normalizedQuery);
}

function sectionLabel(section: SectionConfig) {
  if (section.title) return section.title;
  return section.id
    .split('-')
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

/** Count of sections a tab would show under the current query (0 = no hit). */
function tabMatchCount(tab: SettingsNavTab, normalizedQuery: string) {
  if (!normalizedQuery || tab.isExternal) return 0;
  const content = settingsTabContent[tab.id];
  if (tabHeaderMatchesSearch(tab, normalizedQuery)) return content.sections.length;
  return content.sections.filter((section) => sectionMatchesSearch(section, normalizedQuery))
    .length;
}

function isContentTab(tab: SettingsNavTab): tab is ContentNavTab {
  return !tab.isExternal;
}

export function getSettingsSearchView(activeTab: SettingsPageTab, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const activeContentTab: SettingsContentTab = activeTab === 'docs' ? 'general' : activeTab;

  // Show the active tab's matches; if it has none but another tab does, jump to the first match
  // so results are visible immediately instead of forcing a sidebar click.
  const activeNavTab = settingsTabs.find(
    (tab): tab is ContentNavTab => isContentTab(tab) && tab.id === activeContentTab
  );
  const activeTabMatches = activeNavTab ? tabMatchCount(activeNavTab, normalizedQuery) > 0 : false;
  const firstMatchingTab = normalizedQuery
    ? settingsTabs.find(
        (tab): tab is ContentNavTab => isContentTab(tab) && tabMatchCount(tab, normalizedQuery) > 0
      )
    : undefined;
  const displayedTab =
    normalizedQuery && !activeTabMatches && firstMatchingTab ? firstMatchingTab : activeNavTab;
  const displayedContent = displayedTab ? settingsTabContent[displayedTab.id] : null;

  const tabMatches: SettingsTabMatch[] = settingsTabs.map((tab) => ({
    tab,
    count: tabMatchCount(tab, normalizedQuery),
  }));
  const totalMatches = tabMatches.reduce((sum, match) => sum + match.count, 0);

  const headerMatches = displayedTab
    ? tabHeaderMatchesSearch(displayedTab, normalizedQuery)
    : false;
  const matchingSections =
    displayedContent && normalizedQuery
      ? displayedContent.sections.filter((section) =>
          sectionMatchesSearch(section, normalizedQuery)
        )
      : [];
  // Partial hits → show only matching sections; header/whole-tab match or no query → show all.
  const visibleSections =
    normalizedQuery && !headerMatches && matchingSections.length > 0
      ? matchingSections
      : (displayedContent?.sections ?? []);
  const noMatchesInActiveTab = Boolean(
    normalizedQuery && displayedContent && !headerMatches && matchingSections.length === 0
  );

  // Aggregated results across every tab so all findings are visible at once while searching.
  const resultGroups: SettingsResultGroup[] = normalizedQuery
    ? settingsTabs.filter(isContentTab).flatMap((tab) => {
        const content = settingsTabContent[tab.id];
        const sections = tabHeaderMatchesSearch(tab, normalizedQuery)
          ? content.sections
          : content.sections.filter((section) => sectionMatchesSearch(section, normalizedQuery));
        return sections.length > 0
          ? [{ tab, title: content.title, description: content.description, sections }]
          : [];
      })
    : [];

  return {
    normalizedQuery,
    tabMatches,
    totalMatches,
    displayedTab,
    displayedContent,
    visibleSections,
    noMatchesInActiveTab,
    resultGroups,
  };
}

export function searchSettings(query: string): SettingsSearchResult[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  const results: SettingsSearchResult[] = [];

  for (const tab of settingsTabs) {
    if (tab.isExternal) continue;

    const content = settingsTabContent[tab.id];
    if (tabHeaderMatchesSearch(tab, normalizedQuery)) {
      results.push({
        id: `settings:${tab.id}`,
        tab: tab.id,
        title: `${content.title} Settings`,
        subtitle: content.description,
        score: 2,
      });
    }

    for (const section of content.sections) {
      if (!sectionMatchesSearch(section, normalizedQuery)) continue;
      results.push({
        id: `settings:${tab.id}:${section.id}`,
        tab: tab.id,
        title: sectionLabel(section),
        subtitle: `${content.title} Settings`,
        score: section.title?.toLowerCase().includes(normalizedQuery) ? 3 : 1,
      });
    }
  }

  return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}
