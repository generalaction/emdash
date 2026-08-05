import { type ReactNode, useState } from 'react';
import { PanelTabs } from '@renderer/lib/ui/panel-tabs';

interface Tab {
  value: string;
  label: string;
  content: ReactNode;
}

interface TaskConfigPanelProps {
  tabs: Tab[];
  defaultTab?: string;
  preserveTabContent?: boolean;
}

export function TaskConfigPanel({
  tabs,
  defaultTab,
  preserveTabContent = false,
}: TaskConfigPanelProps) {
  const [activeTab, setActiveTab] = useState<string>(defaultTab ?? tabs[0]?.value ?? '');
  const [mountedTabs, setMountedTabs] = useState<Set<string>>(() => new Set([activeTab]));
  const currentContent = tabs.find((t) => t.value === activeTab)?.content ?? null;
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setMountedTabs((current) => new Set(current).add(tab));
  };
  const content = preserveTabContent ? (
    tabs
      .filter((tab) => mountedTabs.has(tab.value))
      .map((tab) => (
        <div key={tab.value} hidden={tab.value !== activeTab}>
          {tab.content}
        </div>
      ))
  ) : (
    <div>{currentContent}</div>
  );

  return (
    <div className="flex flex-col gap-2">
      <PanelTabs
        value={activeTab}
        onChange={handleTabChange}
        tabs={tabs.map(({ value, label }) => ({ value, label }))}
      />
      {content}
    </div>
  );
}
