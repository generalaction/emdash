import { createContext, useContext } from 'react';
import type { useProjectManagement } from '../hooks/useProjectManagement';

type ProjectManagementContextValue = ReturnType<typeof useProjectManagement>;

export const ProjectManagementContext = createContext<ProjectManagementContextValue | null>(null);

export function useProjectManagementContext(): ProjectManagementContextValue {
  const ctx = useContext(ProjectManagementContext);
  if (!ctx) {
    throw new Error(
      'useProjectManagementContext must be used within a ProjectManagementContext.Provider'
    );
  }
  return ctx;
}
