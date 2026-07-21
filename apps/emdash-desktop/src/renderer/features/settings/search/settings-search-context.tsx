import React, { createContext, useContext } from 'react';

type SettingsSearchState = {
  query: string;
};

const EMPTY_STATE: SettingsSearchState = { query: '' };

const SettingsSearchContext = createContext<SettingsSearchState>(EMPTY_STATE);

export function SettingsSearchProvider({
  query,
  children,
}: {
  query: string;
  children: React.ReactNode;
}) {
  const value = query.trim() ? { query } : EMPTY_STATE;
  return <SettingsSearchContext.Provider value={value}>{children}</SettingsSearchContext.Provider>;
}

export function useSettingsSearch(): SettingsSearchState {
  return useContext(SettingsSearchContext);
}
