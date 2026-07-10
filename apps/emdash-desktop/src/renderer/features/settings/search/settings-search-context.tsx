import React, { createContext, useContext, useMemo } from 'react';
import { cn } from '@renderer/utils/utils';
import { matchedIdsForQuery } from './settings-search';

type SettingsSearchState = {
  query: string;
  matchedIds: ReadonlySet<string>;
};

const EMPTY_STATE: SettingsSearchState = { query: '', matchedIds: new Set() };

const SettingsSearchContext = createContext<SettingsSearchState>(EMPTY_STATE);

export function SettingsSearchProvider({
  query,
  children,
}: {
  query: string;
  children: React.ReactNode;
}) {
  const value = useMemo<SettingsSearchState>(
    () => (query.trim() ? { query, matchedIds: matchedIdsForQuery(query) } : EMPTY_STATE),
    [query]
  );
  return <SettingsSearchContext.Provider value={value}>{children}</SettingsSearchContext.Provider>;
}

export function useSettingsSearch(): SettingsSearchState {
  return useContext(SettingsSearchContext);
}

/** Returns true when the setting with this search id matches the active search query. */
export function useSettingsSearchHighlight(id: string | undefined): boolean {
  const { query, matchedIds } = useSettingsSearch();
  return Boolean(query && id && matchedIds.has(id));
}

export const SETTING_HIGHLIGHT_CLASS =
  'rounded-md ring-2 ring-ring/50 ring-offset-4 ring-offset-background';

/**
 * Marks a settings block (card or section) as the render target for a search
 * index entry, so it is highlighted when the entry matches the active query.
 * SettingRow does this automatically for rows with string titles.
 */
export function SettingsSearchTarget({
  id,
  children,
  className,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  const highlighted = useSettingsSearchHighlight(id);
  return (
    <div
      data-setting-id={id}
      data-highlighted={highlighted || undefined}
      className={cn(highlighted && SETTING_HIGHLIGHT_CLASS, className)}
    >
      {children}
    </div>
  );
}
