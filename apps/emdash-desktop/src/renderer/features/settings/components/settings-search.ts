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

function matchesSearch(parts: Array<string | undefined>, normalizedQuery: string) {
  return parts.filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery);
}

function tabMatchesSearch(tab: SettingsNavTab, normalizedQuery: string) {
  if (!normalizedQuery) return true;
  if (tab.isExternal) return false;

  const content = settingsTabContent[tab.id];
  return matchesSearch(
    [
      tab.label,
      content.title,
      content.description,
      ...content.sections.flatMap((section) => [section.title, section.searchText]),
    ],
    normalizedQuery
  );
}

function tabHeaderMatchesSearch(tab: SettingsNavTab, normalizedQuery: string) {
  if (!normalizedQuery || tab.isExternal) return false;

  const content = settingsTabContent[tab.id];
  return matchesSearch([tab.label, content.title, content.description], normalizedQuery);
}

function sectionMatchesSearch(section: SectionConfig, normalizedQuery: string) {
  return matchesSearch([section.title, section.searchText], normalizedQuery);
}

function isContentTab(tab: SettingsNavTab): tab is ContentNavTab {
  return !tab.isExternal;
}

export function getSettingsSearchView(activeTab: SettingsPageTab, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const activeContentTab: SettingsContentTab = activeTab === 'docs' ? 'general' : activeTab;
  const activeNavTab = settingsTabs.find(
    (tab): tab is ContentNavTab => isContentTab(tab) && tab.id === activeContentTab
  );

  if (!normalizedQuery) {
    const displayedContent = activeNavTab ? settingsTabContent[activeNavTab.id] : null;

    return {
      isEmpty: false,
      visibleTabs: settingsTabs,
      displayedTab: activeNavTab,
      displayedContent,
      visibleSections: displayedContent?.sections ?? [],
    };
  }

  const matchingTabs = settingsTabs.filter((tab) => tabMatchesSearch(tab, normalizedQuery));
  const matchingContentTabs = matchingTabs.filter(isContentTab);

  if (matchingContentTabs.length === 0) {
    return {
      isEmpty: true,
      visibleTabs: [],
      displayedTab: undefined,
      displayedContent: null,
      visibleSections: [],
    };
  }

  const displayedTab =
    activeNavTab && tabMatchesSearch(activeNavTab, normalizedQuery)
      ? activeNavTab
      : matchingContentTabs[0];
  const displayedContent = settingsTabContent[displayedTab.id];
  const visibleSections = tabHeaderMatchesSearch(displayedTab, normalizedQuery)
    ? displayedContent.sections
    : displayedContent.sections.filter((section) => sectionMatchesSearch(section, normalizedQuery));

  return {
    isEmpty: false,
    visibleTabs: matchingTabs,
    displayedTab,
    displayedContent,
    visibleSections,
  };
}
