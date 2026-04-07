import React from 'react';
import { motion } from 'motion/react';
import { ChevronRight } from 'lucide-react';
import type { SearchResult } from '@/hooks/useSettingsSearch';
import { groupResultsByTab } from '@/hooks/useSettingsSearch';
import type { SettingsPageTab } from './SettingsPage';

const TAB_LABELS: Record<SettingsPageTab, string> = {
  general: 'General',
  'clis-models': 'Agents',
  integrations: 'Integrations',
  repository: 'Repository',
  interface: 'Interface',
  account: 'Account',
  docs: 'Docs',
};

interface SettingsSearchResultsProps {
  results: SearchResult[];
  query: string;
  onResultClick: (tabId: SettingsPageTab, elementId: string) => void;
}

function highlightMatches(text: string, query: string) {
  if (!query.trim()) return text;

  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  let index = textLower.indexOf(queryLower);
  while (index !== -1) {
    if (index > lastIndex) {
      parts.push(text.slice(lastIndex, index));
    }
    parts.push(
      <mark key={index} className="rounded bg-primary/15 px-0.5 font-medium text-inherit">
        {text.slice(index, index + query.length)}
      </mark>
    );
    lastIndex = index + query.length;
    index = textLower.indexOf(queryLower, lastIndex);
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

export const SettingsSearchResults: React.FC<SettingsSearchResultsProps> = ({
  results,
  query,
  onResultClick,
}) => {
  const grouped = React.useMemo(() => groupResultsByTab(results), [results]);

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-sm text-muted-foreground">No settings found for "{query}"</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <p className="text-sm text-muted-foreground">
        {results.length} {results.length === 1 ? 'result' : 'results'}
      </p>

      {Array.from(grouped.entries()).map(([tabId, tabResults]) => (
        <motion.div
          key={tabId}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-3"
        >
          <h3 className="text-sm font-medium text-muted-foreground">
            {TAB_LABELS[tabId as SettingsPageTab] || tabId}
          </h3>
          <div className="flex flex-col gap-2">
            {tabResults.map((result) => (
              <button
                key={result.setting.id}
                type="button"
                onClick={() => onResultClick(tabId as SettingsPageTab, result.setting.elementId)}
                className="group flex items-start justify-between gap-4 rounded-md px-4 py-3 text-left transition-colors hover:bg-muted/60"
              >
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium">
                    {highlightMatches(result.setting.label, query)}
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {highlightMatches(result.setting.description, query)}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </button>
            ))}
          </div>
        </motion.div>
      ))}
    </div>
  );
};

export default SettingsSearchResults;
