import { createContext, ReactNode } from 'react';

interface PendingTasksContextValue {}

const PendingTasksContext = createContext<PendingTasksContextValue | null>(null);

export function PendingTasksProvider({ children }: { children: ReactNode }) {
  return <PendingTasksContext.Provider value={{}}>{children}</PendingTasksContext.Provider>;
}
